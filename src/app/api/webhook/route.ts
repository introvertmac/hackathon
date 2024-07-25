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
🎉 Welcome to the Dappshunt Coupon Verification Bot! 🚀

I'm your friendly neighborhood bot, here to help you unlock the treasure trove of knowledge in your exclusive Dappshunt report.

Ready to embark on this exciting journey? Let's get started!

🔑 Use the buttons below to begin your adventure:
• '🚀 Start' - For a quick refresher on how I can help you.
• '🔍 Verify Coupon' - To start the magical verification process!

Remember, I'm here to make this process as smooth as butter on a hot pancake. So, don't hesitate to ask if you need any help along the way!
`;

// Default message when the user first visits the bot
const defaultMessage = `
Hello there, brave explorer of the Dappshunt universe! 👋

I'm your trusty Coupon Verification Bot, at your service 24/7. 🤖✨

Here's your mission, should you choose to accept it:
1. Click '🔍 Verify Coupon' to begin your quest.
2. Enter your 12-character coupon code (it's like a secret password!).
3. Provide the transaction signature (think of it as your digital fingerprint).

And voilà! You'll unlock your exclusive Dappshunt report faster than you can say "blockchain"!

Ready to dive in? Hit that '🔍 Verify Coupon' button and let's make some magic happen!
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
    ctx.reply('Excellent choice! 🎩✨ Now, please send me your 12-character coupon code. It\'s like the golden ticket to your Dappshunt wonderland!');
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
    ctx.reply('Oops! It seems we\'ve wandered off the path. 🌿 No worries, though! Just use the buttons below to start your journey or verify your coupon. Let\'s get back on track!', mainKeyboard);
  }
});

async function handleCouponInput(ctx: Context, userId: number, userState: UserState) {
  const message = ctx.message as Message.TextMessage;
  const couponCode = message.text.trim().toUpperCase();

  if (couponCode.length !== 12 || !/^[A-Z0-9]+$/.test(couponCode)) {
    return sendErrorMessage(ctx, 'Oops! 🙈 That coupon code seems to be playing hide and seek. Remember, we\'re looking for a 12-character alphanumeric code. It\'s like a secret handshake, but with letters and numbers. Want to give it another shot?', '🔍 Verify Coupon');
  }

  const isCouponValid = await checkCouponValidity(couponCode);
  if (!isCouponValid) {
    return sendErrorMessage(ctx, 'Oh no! 😟 It looks like this coupon code has already embarked on its own adventure or got lost in the digital abyss. Don\'t worry, though! Double-check your code and try again. If you\'re sure it\'s correct, maybe it\'s time to contact our support team for a new one?', '🔍 Verify Coupon');
  }

  userStates.set(userId, { step: 'SIGNATURE', couponCode });
  ctx.reply('Fantastic! 🎉 You\'ve cracked the first part of the code. Now, for the grand finale, please send me the transaction signature. You can find this digital autograph in your wallet\'s transaction history or on the Solscan transaction page. It\'s the key to unlocking your treasure!');
}

async function handleSignatureInput(ctx: Context, userId: number, userState: UserState) {
  const message = ctx.message as Message.TextMessage;
  const signature = message.text.trim();

  const { couponCode } = userState;

  if (!couponCode) {
    return sendErrorMessage(ctx, 'Uh-oh! 😅 It seems we\'ve hit a small bump in our digital road. Don\'t worry, these things happen in the vast world of blockchain. Let\'s start our adventure again, shall we?', '🔍 Verify Coupon');
  }

  if (!isValidSignatureFormat(signature)) {
    return sendErrorMessage(ctx, 'Hmm... 🤔 This signature looks like it\'s trying to impersonate a real Solana transaction signature, but it\'s not quite there. It\'s like trying to use Monopoly money at a real store - close, but not quite right! Want to double-check and try again?', '🔍 Verify Coupon');
  }

  ctx.reply('Alright, exciting times ahead! 🕵️‍♂️ I\'m now verifying your transaction signature faster than you can say "blockchain". Hang tight!');

  const verificationResult = await verifyCouponAndSignature(couponCode, signature);

  if (verificationResult.isValid && verificationResult.recordId) {
    await activateCoupon(verificationResult.recordId, signature);
    await ctx.reply('🎉🎊 Woohoo! You did it! Your coupon has been verified and activated. You\'re officially a Dappshunt VIP now!');
    
    await ctx.reply('📬 Your exclusive Dappshunt report is being prepared and will materialize in your chat any second now. Get ready for a knowledge explosion!');
    
    // Send the report file
    const filePath = path.join(process.cwd(), 'public', 'dappshunt_report.pdf');
    await ctx.replyWithDocument({ source: fs.createReadStream(filePath), filename: 'dappshunt_report.pdf' });
    
    await ctx.reply(
      '📚 Tada! Your Dappshunt report has arrived, hot off the digital press! It\'s packed with more insider knowledge than a librarian\'s secret diary.\n\n' +
      '🧠 As you dive into this treasure trove of information, remember: knowledge is power, but applied knowledge is a superpower!\n\n' +
      '🚀 If you ever need a friendly chat about the report or have any questions, our support team is just a message away.\n\n' +
      'Now go forth and conquer the world of indie hacking! May the code be with you! 💻✨',
      mainKeyboard
    );
  } else {
    sendErrorMessage(ctx, 'Houston, we have a problem! 🛸 The transaction signature seems to be from a parallel universe - it doesn\'t match our records for this coupon. Are you sure you used the right signature? Let\'s embark on this verification quest one more time!', '🔍 Verify Coupon');
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
    '🤔 Hmm... It seems like you\'re speaking in riddles, my friend. While I appreciate a good enigma, I\'m not quite as clever as the Sphinx.\n\n' +
    'Let\'s stick to a language we both understand - the buttons below! They\'re like magic portals to start your journey or verify your coupon. Shall we try again?',
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
    return NextResponse.json({ error: 'Oops! Our digital gears got a bit tangled. Please try again in a moment.' }, { status: 500 });
  }
}