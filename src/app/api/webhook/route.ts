import { NextRequest, NextResponse } from 'next/server';
import { Telegraf, Context } from 'telegraf';
import { Update } from 'telegraf/types';
import Airtable from 'airtable';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';

// Initialize bot and database connection
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const base = new Airtable({ apiKey: process.env.AIRTABLE_COUPON_API_KEY }).base(process.env.AIRTABLE_COUPON_BASE_ID!);

// Constants
const COUPON_EXPIRATION_HOURS = 24;

// Simple in-memory state management (consider using a database for production)
const userStates = new Map<number, { step: 'COUPON' | 'WALLET'; couponCode?: string }>();

bot.command('start', (ctx) => {
  const userId = ctx.from.id;
  userStates.set(userId, { step: 'COUPON' });
  ctx.reply(
    '🎉 Welcome to Dappshunt Coupon Verification! 🚀\n\n' +
    'I\'m here to help you verify your coupon and unlock your exclusive Dappshunt report. Here\'s how it works:\n\n' +
    '1️⃣ First, you\'ll send me your coupon code\n' +
    '2️⃣ Then, you\'ll provide the wallet address you used for payment\n\n' +
    'Ready to begin? Please send me your coupon code now!'
  );
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userState = userStates.get(userId) || { step: 'COUPON' };

  if (userState.step === 'COUPON') {
    const couponCode = ctx.message.text.trim().toUpperCase();
    userStates.set(userId, { step: 'WALLET', couponCode });
    ctx.reply(
      '👍 Great! I\'ve received your coupon code.\n\n' +
      'Now, please send me the wallet address you used for payment. ' +
      'Remember, this should be the exact address you used, as it\'s case-sensitive.'
    );
  } else if (userState.step === 'WALLET') {
    const walletAddress = ctx.message.text.trim(); // Keep original case
    const couponCode = userState.couponCode!;

    try {
      const { isValid, record } = await verifyCoupon(couponCode, walletAddress);
      
      if (isValid && record) {
        await activateCoupon(record.id);
        await ctx.reply(
          '🎊 Fantastic news! Your coupon has been successfully verified and activated.\n\n' +
          'Thank you for your purchase! Your exclusive Dappshunt report is now ready for download. ' +
          'I\'ll send it to you right away!'
        );
        
        // Here you would send the report file
        // For example: await ctx.replyWithDocument({ source: reportFilePath, filename: 'dappshunt_report.pdf' });
        
        await ctx.reply(
          '📚 Enjoy diving into your Dappshunt report! It\'s packed with valuable insights into the world of indie hacking.\n\n' +
          'If you have any questions or need further assistance, don\'t hesitate to reach out to our support team.\n\n' +
          'Happy reading, and best of luck with your projects! 🚀'
        );
      } else {
        await ctx.reply(
          '😕 I\'m sorry, but I couldn\'t verify your coupon. This could be because:\n\n' +
          '• The coupon code is invalid\n' +
          '• The wallet address doesn\'t match our records\n' +
          '• The coupon has already been used\n\n' +
          'If you believe this is an error, please double-check your coupon code and wallet address, then try again by sending /start. ' +
          'If you continue to have issues, please contact our support team for assistance.'
        );
      }
    } catch (error) {
      console.error('Error processing coupon:', error);
      await ctx.reply(
        '😓 Oops! We encountered an unexpected issue while processing your coupon.\n\n' +
        'Please try again later by sending /start. If the problem persists, ' +
        'don\'t hesitate to reach out to our support team for help.'
      );
    }

    // Reset user state after processing
    userStates.delete(userId);
  }
});

// Handle unknown messages
bot.on('message', (ctx) => {
  ctx.reply(
    '🤔 I\'m not sure I understood that.\n\n' +
    'To verify your coupon, please start the process by sending /start. ' +
    'I\'ll then guide you through the steps to verify your coupon and get your Dappshunt report.'
  );
});

async function verifyCoupon(code: string, walletAddress: string): Promise<{ isValid: boolean; record?: any }> {
  return new Promise((resolve, reject) => {
    base('Coupons').select({
      filterByFormula: `AND({Code} = '${code}', {UserAccount} = '${walletAddress}', {Status} = 'Pending', {ExpiresAt} > NOW())`
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