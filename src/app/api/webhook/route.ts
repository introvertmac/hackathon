import { NextRequest, NextResponse } from 'next/server';
import { Telegraf } from 'telegraf';
import { Update } from 'telegraf/types';
import Airtable from 'airtable';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const base = new Airtable({ apiKey: process.env.AIRTABLE_COUPON_API_KEY }).base(process.env.AIRTABLE_COUPON_BASE_ID!);

const PAYMENT_AMOUNT = 0.0058 * 1e9; // 0.0058 SOL in lamports
const RECIPIENT_ADDRESS = new PublicKey("2KsTX7z6AFR5cMjNuiWmrBSPHPk3F3tb7K5Fw14iek3t");

bot.command('start', (ctx) => {
  ctx.reply('Welcome to Dappshunt! 🚀\n\nTo verify your coupon, please send your coupon code and wallet address in the following format:\n\nVERIFY couponcode walletaddress');
});

bot.hears(/^VERIFY\s+(\w+)\s+(\S+)$/i, async (ctx) => {
  const couponCode = ctx.match[1].toUpperCase();
  const walletAddress = ctx.match[2];

  try {
    const { isValid, record } = await isValidPendingCoupon(couponCode, walletAddress);
    
    if (isValid && record) {
      const isPaymentConfirmed = await verifyPayment(walletAddress);
      
      if (isPaymentConfirmed) {
        await activateCoupon(record.id);
        await ctx.reply('🎉 Fantastic! Your coupon is now activated.\n\nThank you for your purchase! Your exclusive Dappshunt report is being prepared for download.');
        
        const filePath = path.join(process.cwd(), 'public', 'dappshunt_report.pdf');
        await ctx.replyWithDocument({ source: fs.createReadStream(filePath), filename: 'dappshunt_report.pdf' });
        
        await ctx.reply('Enjoy your insights into the world of Indie hacking!');
      } else {
        await ctx.reply('We couldn\'t verify your payment. Please ensure you\'ve completed the transaction and try again in a few minutes.');
      }
    } else {
      await ctx.reply('Sorry, this coupon appears to be invalid or has already been used. If you believe this is an error, please contact our support team.');
    }
  } catch (error) {
    console.error('Error processing coupon:', error);
    await ctx.reply('Oops! We encountered an issue while processing your coupon. Please try again later or contact our support team if the problem persists.');
  }
});

async function isValidPendingCoupon(code: string, walletAddress: string): Promise<{ isValid: boolean; record?: any }> {
  return new Promise((resolve, reject) => {
    base('Coupons').select({
      filterByFormula: `AND({Code} = '${code}', {Status} = 'Pending', {UserAccount} = '${walletAddress}', {ExpiresAt} > NOW())`
    }).firstPage((err, records) => {
      if (err) {
        console.error('Error checking coupon validity:', err);
        reject(err);
        return;
      }
      if (records && records.length > 0) {
        resolve({ isValid: true, record: records[0] });
      } else {
        resolve({ isValid: false });
      }
    });
  });
}

async function verifyPayment(walletAddress: string): Promise<boolean> {
  const connection = new Connection(process.env.SOLANA_MAINNET_RPC! || clusterApiUrl("mainnet-beta"));
  const publicKey = new PublicKey(walletAddress);

  try {
    const transactions = await connection.getSignaturesForAddress(publicKey, { limit: 10 });

    for (const tx of transactions) {
      const transaction = await connection.getParsedTransaction(tx.signature);
      if (transaction) {
        const instruction = transaction.transaction.message.instructions[0];
        if ('parsed' in instruction && instruction.parsed.type === 'transfer') {
          const { info } = instruction.parsed;
          if (info.destination === RECIPIENT_ADDRESS.toString() && info.lamports === PAYMENT_AMOUNT) {
            return true;
          }
        }
      }
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
  }

  return false;
}

async function activateCoupon(recordId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    base('Coupons').update([
      {
        id: recordId,
        fields: {
          Status: 'Active',
          ActivatedAt: new Date().toISOString()
        }
      }
    ], (err) => {
      if (err) {
        console.error("Error activating coupon:", err);
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    await bot.handleUpdate(body as Update);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error processing update:', error);
    return NextResponse.json({ error: 'Failed to process update' }, { status: 500 });
  }
}