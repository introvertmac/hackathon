import { NextRequest, NextResponse } from 'next/server';
import { Telegraf, Context, Markup } from 'telegraf';
import { Update, Message } from 'telegraf/types';
import Airtable from 'airtable';
import { PublicKey, Connection } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

// Initialize bot and database connection
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const base = new Airtable({ apiKey: process.env.AIRTABLE_COUPON_API_KEY }).base(process.env.AIRTABLE_COUPON_BASE_ID!);
const solanaRpcUrl = process.env.SOLANA_MAINNET_RPC!;
const connection = new Connection(solanaRpcUrl);

// Custom keyboard markup
const mainKeyboard = Markup.keyboard([
  ['🚀 Start', '🔍 Verify Coupon']
]).resize();

// User state management
type UserState = {
  step: 'IDLE' | 'COUPON' | 'SIGNATURE';
  couponCode?: string;
};

const userStates = new Map<number, UserState>();

// Welcome message
const welcomeMessage = `
🎉 Welcome to Dappshunt Coupon Verification! 🚀

I'm here to help you verify your coupon and unlock your exclusive Dappshunt report.

Use the buttons below to start or verify your coupon. Let's get started!
`;

// Default message when the user first visits the bot
const defaultMessage = `
Hello and welcome to the Dappshunt Coupon Verification Bot! 🤖

I'm here to assist you in verifying your coupon to unlock exclusive content. Here's what you can do:
- Click '🚀 Start' to get a brief overview of this bot.
- Click '🔍 Verify Coupon' to start the coupon verification process.

If you have any questions, feel free to ask!
`;

bot.command('start', (ctx) => {
  const userId = ctx.from?.id;
  if (userId) {
    userStates.set(userId, { step: 'IDLE' });
    ctx.reply(defaultMessage, mainKeyboard);
  }
});

bot.hears('🚀 Start', (ctx) => {
  ctx.reply(welcomeMessage, mainKeyboard);
});

bot.hears('🔍 Verify Coupon', (ctx) => {
  const userId = ctx.from?.id;
  if (userId) {
    userStates.set(userId, { step: 'COUPON' });
    ctx.reply('Great! Please send me your 12-character coupon code.');
  }
});

bot.on('text', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const userState = userStates.get(userId) || { step: 'IDLE' };

  if (userState.step === 'COUPON') {
    await handleCouponInput(ctx, userId, userState);
  } else if (userState.step === 'SIGNATURE') {
    await handleSignatureInput(ctx, userId, userState);
  } else {
    ctx.reply('Please use the buttons to start or verify your coupon.', mainKeyboard);
  }
});

async function handleCouponInput(ctx: Context, userId: number, userState: UserState) {
  const message = ctx.message as Message.TextMessage;
  const couponCode = message.text.trim().toUpperCase();

  if (couponCode.length !== 12 || !/^[A-Z0-9]+$/.test(couponCode)) {
    return sendErrorMessage(ctx, 'Oops! That doesn\'t look like a valid coupon code. Please enter a 12-character alphanumeric code.', '🔍 Verify Coupon');
  }

  const isCouponValid = await checkCouponValidity(couponCode);
  if (!isCouponValid) {
    return sendErrorMessage(ctx, 'Sorry, this coupon code is not valid or has already been used. Please check your code and try again.', '🔍 Verify Coupon');
  }

  userStates.set(userId, { step: 'SIGNATURE', couponCode });
  ctx.reply('Great! Now, please send me the transaction signature. You can find it in your wallet transaction history or on the Solscan transaction page.');
}

async function handleSignatureInput(ctx: Context, userId: number, userState: UserState) {
  const message = ctx.message as Message.TextMessage;
  const signature = message.text.trim();

  const { couponCode } = userState;

  if (!couponCode) {
    return sendErrorMessage(ctx, 'Sorry, there was an error processing your request. Please start over.', '🔍 Verify Coupon');
  }

  if (!isValidSignatureFormat(signature)) {
    return sendErrorMessage(ctx, 'That doesn\'t look like a valid Solana transaction signature. Please double-check and try again.', '🔍 Verify Coupon');
  }

  ctx.reply('Verifying your transaction signature, please wait...');

  const verificationResult = await verifyCouponAndSignature(couponCode, signature);

  if (verificationResult.isValid && verificationResult.recordId) {
    await activateCoupon(verificationResult.recordId, signature);
    await ctx.reply('🎉 Congratulations! Your coupon has been successfully verified and activated.');
    
    // Send the report file
    const filePath = path.join(process.cwd(), 'public', 'dappshunt_report.pdf');
    await ctx.replyWithDocument({ source: fs.createReadStream(filePath), filename: 'dappshunt_report.pdf' });
    
    await ctx.reply(
      '📚 Enjoy your Dappshunt report! It\'s packed with valuable insights into the world of indie hacking.\n\n' +
      'If you have any questions, feel free to reach out to our support team.\n\n' +
      'Happy reading, and best of luck with your projects! 🚀',
      mainKeyboard
    );
  } else {
    sendErrorMessage(ctx, 'Sorry, the transaction signature is not valid for the provided coupon. Please ensure you\'re using the correct signature. Start the verification process again by clicking the button below.', '🔍 Verify Coupon');
  }

  userStates.set(userId, { step: 'IDLE' });
}

function isValidSignatureFormat(signature: string): boolean {
  return /^[A-Za-z0-9]{87,88}$/.test(signature);
}

async function checkCouponValidity(code: string): Promise<boolean> {
  return new Promise((resolve) => {
    base('Coupons').select({
      filterByFormula: `AND({Code} = '${code}', {Status} != 'Used')`
    }).firstPage((err, records) => {
      if (err) {
        console.error('Error checking coupon validity:', err);
        resolve(false);
        return;
      }
      resolve(records !== undefined && records.length > 0);
    });
  });
}

async function verifyCouponAndSignature(code: string, signature: string): Promise<{ isValid: boolean; recordId?: string }> {
  return new Promise((resolve) => {
    base('Coupons').select({
      filterByFormula: `{Code} = '${code}'`
    }).firstPage(async (err, records) => {
      if (err) {
        console.error('Error verifying coupon:', err);
        resolve({ isValid: false });
        return;
      }
      if (records && records.length > 0) {
        const record = records[0];
        const walletAddress = record.get('UserAccount') as string;

        if (await checkSignature(walletAddress, signature)) {
          resolve({ isValid: true, recordId: record.id });
        } else {
          resolve({ isValid: false });
        }
      } else {
        resolve({ isValid: false });
      }
    });
  });
}

async function checkSignature(walletAddress: string, signature: string): Promise<boolean> {
  try {
    const transaction = await connection.getTransaction(signature);
    if (transaction && transaction.transaction.message.accountKeys.some(key => key.toString() === walletAddress)) {
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error checking signature:', error);
    return false;
  }
}

async function activateCoupon(recordId: string, signature: string): Promise<void> {
  return new Promise((resolve, reject) => {
    base('Coupons').update([
      {
        id: recordId,
        fields: {
          Status: 'Used',
          UsedAt: new Date().toISOString(),
          Signature: signature
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

function sendErrorMessage(ctx: Context, message: string, retryButton: string) {
  ctx.reply(
    `${message}\n\nClick the button below to try again.`,
    Markup.keyboard([retryButton]).resize()
  );
  const userId = ctx.from?.id;
  if (userId) {
    userStates.set(userId, { step: 'IDLE' });
  }
}

// Handle unknown messages
bot.on('message', (ctx) => {
  ctx.reply(
    '🤔 I\'m not sure I understood that.\n\n' +
    'Please use the buttons below to start or verify your coupon.',
    mainKeyboard
  );
});

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
