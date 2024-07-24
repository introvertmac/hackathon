// File: app/api/webhook/route.ts

import { NextResponse } from 'next/server';
import { Telegraf } from 'telegraf';
import Airtable from 'airtable';

// Initialize Telegram bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Initialize Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_COUPON_API_KEY }).base(process.env.AIRTABLE_COUPON_BASE_ID!);

// Helper function to normalize coupon code
const normalizeCoupon = (code: string) => code.trim().toUpperCase();

// Helper function to check if a coupon is valid
const isValidCoupon = async (code: string): Promise<boolean> => {
  const records = await base('Coupons').select({
    filterByFormula: `AND({Code} = '${code}', {Status} = 'Active')`
  }).firstPage();
  return records.length > 0;
};

// Helper function to mark a coupon as used
const markCouponAsUsed = async (code: string) => {
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

// Bot command handler
bot.on('text', async (ctx) => {
  const message = ctx.message.text;
  const normalizedCoupon = normalizeCoupon(message);

  if (normalizedCoupon.length !== 12 || !/^[A-Z0-9]+$/.test(normalizedCoupon)) {
    await ctx.reply('Invalid coupon format. Please enter a valid 12-character coupon code.');
    return;
  }

  try {
    if (await isValidCoupon(normalizedCoupon)) {
      await markCouponAsUsed(normalizedCoupon);
      await ctx.reply('Coupon is valid! Here is the link to the report: https://www.helius.dev/');
    } else {
      await ctx.reply('Invalid or expired coupon. Please try again with a valid coupon code.');
    }
  } catch (error) {
    console.error('Error processing coupon:', error);
    await ctx.reply('An error occurred while processing your coupon. Please try again later.');
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

export async function GET() {
  return NextResponse.json({ message: 'Webhook is active' });
}