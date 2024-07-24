import { NextResponse } from 'next/server';
import { Telegraf } from 'telegraf';
import Airtable from 'airtable';
import fs from 'fs';
import path from 'path';

// Initialize Telegram bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Initialize Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_COUPON_API_KEY }).base(process.env.AIRTABLE_COUPON_BASE_ID!);

// Helper function to normalize coupon code
const normalizeCoupon = (code: string): string => code.trim().toUpperCase();

// Helper function to check if a coupon is valid
const isValidCoupon = async (code: string): Promise<boolean> => {
  const records = await base('Coupons').select({
    filterByFormula: `AND({Code} = '${code}', {Status} = 'Active')`
  }).firstPage();
  return records.length > 0;
};

// Helper function to mark a coupon as used
const markCouponAsUsed = async (code: string): Promise<void> => {
  const records = await base('Coupons').select({
    filterByFormula: `{Code} = '${code}'`
  }).firstPage();

  if (records.length > 0) {
    await base('Coupons').update([
      {
        id: records[0].id,
        fields: {
          UsedAt: new Date().toISOString(),
          Status: 'Used'
        }
      }
    ]);
  }
};

// Welcome message
bot.command('start', (ctx) => {
  ctx.reply('Welcome to Dappshunt! 🚀\n\nWe\'re excited to have you here. Please enter your 12-character coupon code to access your exclusive report.');
});

// Bot message handler
bot.on('text', async (ctx) => {
  const message = ctx.message.text;
  
  if (message && message !== '/start') {
    const normalizedCoupon = normalizeCoupon(message);

    if (normalizedCoupon.length !== 12 || !/^[A-Z0-9]+$/.test(normalizedCoupon)) {
      await ctx.reply('Oops! That doesn\'t look like a valid coupon code. Please enter a 12-character alphanumeric code.');
      return;
    }

    try {
      if (await isValidCoupon(normalizedCoupon)) {
        await markCouponAsUsed(normalizedCoupon);
        
        // Send success message
        await ctx.reply('🎉 Fantastic! Your coupon is valid.\n\nThank you for your purchase! Your exclusive Dappshunt report is being prepared for download.');
        
        // Send the report file
        const filePath = path.join(process.cwd(), 'public', 'report.pdf');
        await ctx.replyWithDocument({ source: fs.createReadStream(filePath), filename: 'dappshunt_report.pdf' });
        
        await ctx.reply('Enjoy your insights into the world of dapps!');
      } else {
        await ctx.reply('Sorry, this coupon appears to be invalid or has already been used. If you believe this is an error, please contact our support team.');
      }
    } catch (error) {
      console.error('Error processing coupon:', error);
      await ctx.reply('Oops! We encountered an issue while processing your coupon. Please try again later or contact our support team if the problem persists.');
    }
  }
});

// Webhook handler
export async function POST(request: Request) {
  try {
    const body = await request.json();
    await bot.handleUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in webhook handler:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// Webhook status check
export async function GET() {
  return NextResponse.json({ message: 'Webhook is active' });
}