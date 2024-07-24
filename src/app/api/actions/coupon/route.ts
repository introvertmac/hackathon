import {
  ActionGetResponse,
  ActionPostResponse,
  ACTIONS_CORS_HEADERS,
  ActionPostRequest,
  createPostResponse,
} from "@solana/actions";
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  clusterApiUrl,
} from "@solana/web3.js";
import Airtable from 'airtable';
import { randomBytes, createHash } from 'crypto';

// Configure Airtable
if (!process.env.AIRTABLE_COUPON_API_KEY || !process.env.AIRTABLE_COUPON_BASE_ID) {
  throw new Error('Airtable configuration is missing');
}

const base = new Airtable({ apiKey: process.env.AIRTABLE_COUPON_API_KEY }).base(process.env.AIRTABLE_COUPON_BASE_ID!);

const PAYMENT_AMOUNT = 0.0058 * 1e9; // 0.0058 SOL in lamports
const RECIPIENT_ADDRESS = new PublicKey("2KsTX7z6AFR5cMjNuiWmrBSPHPk3F3tb7K5Fw14iek3t");
const MAX_ATTEMPTS = 10;

export const GET = async (req: Request): Promise<Response> => {
  const payload: ActionGetResponse = {
    title: "Generate Coupon",
    icon: new URL("/coupon.png", new URL(req.url).origin).toString(),
    description: "Pay 0.0058 SOL to generate a unique coupon code for our @Dappshuntbot Telegram channel report",
    label: "Generate Coupon",
  };

  return new Response(JSON.stringify(payload), {
    headers: {
      ...ACTIONS_CORS_HEADERS,
      'Content-Type': 'application/json'
    },
  });
};

export const OPTIONS = async (): Promise<Response> => {
  return new Response(null, {
    headers: ACTIONS_CORS_HEADERS,
  });
};

export const POST = async (req: Request): Promise<Response> => {
  try {
    const body: ActionPostRequest = await req.json();

    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch (err) {
      throw new Error('Invalid "account" provided');
    }

    const connection = new Connection(process.env.SOLANA_RPC! || clusterApiUrl("mainnet-beta"));

    const { blockhash } = await connection.getLatestBlockhash();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: account,
        toPubkey: RECIPIENT_ADDRESS,
        lamports: PAYMENT_AMOUNT,
      })
    );

    transaction.feePayer = account;
    transaction.recentBlockhash = blockhash;

    // Generate the coupon code
    const couponCode = await generateUniqueCouponCode();

    // Save the coupon to Airtable without status
    await saveCouponToAirtable(couponCode, account.toString());

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        transaction,
        message: `Your coupon code is: ${couponCode}. Verify your coupon in our Telegram bot @Dappshuntbot.`,
      },
    });

    return new Response(JSON.stringify({ ...payload, couponCode }), {
      headers: {
        ...ACTIONS_CORS_HEADERS,
        'Content-Type': 'application/json'
      },
    });
  } catch (err) {
    console.error('Error in POST handler:', err);
    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 400,
      headers: {
        ...ACTIONS_CORS_HEADERS,
        'Content-Type': 'application/json'
      },
    });
  }
};

function generateUniqueCode(): string {
  const bytes = randomBytes(16);
  const hash = createHash('sha256').update(bytes).digest('hex');
  return hash.slice(0, 12).toUpperCase();
}

async function isCodeUnique(code: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    base('Coupons').select({
      filterByFormula: `{Code} = '${code}'`
    }).firstPage((err, records) => {
      if (err) {
        console.error('Error checking code uniqueness:', err);
        reject(err);
        return;
      }
      resolve(records!.length === 0);
    });
  });
}

async function saveCouponToAirtable(code: string, userAccount: string): Promise<void> {
  return new Promise((resolve, reject) => {
    base('Coupons').create({
      "Code": code,
      "CreatedAt": new Date().toISOString(),
      "UserAccount": userAccount,
    }, (err: Error | null) => {
      if (err) {
        console.error("Error saving coupon to Airtable:", err);
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function generateUniqueCouponCode(): Promise<string> {
  let code: string;
  let attempts = 0;
  do {
    code = generateUniqueCode();
    attempts++;
    if (attempts >= MAX_ATTEMPTS) {
      throw new Error("Failed to generate a unique code after multiple attempts");
    }
  } while (!(await isCodeUnique(code)));
  return code;
}
