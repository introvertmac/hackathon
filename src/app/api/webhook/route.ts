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
  ParsedInstruction,
  PartiallyDecodedInstruction,
} from "@solana/web3.js";
import Airtable, { FieldSet, Records } from 'airtable';
import { randomBytes, createHash } from 'crypto';

// Configure Airtable
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

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: account,
        toPubkey: RECIPIENT_ADDRESS,
        lamports: PAYMENT_AMOUNT,
      })
    );

    transaction.feePayer = account;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // Generate the coupon code
    const code = await generateUniqueCouponCode();

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        transaction,
        message: `Your coupon code is: ${code}. It will be activated after successful transaction.`,
      },
    });

    // Save the coupon to Airtable with 'Pending' status
    await saveCouponToAirtable(code, 'Pending');

    return new Response(JSON.stringify(payload), {
      headers: {
        ...ACTIONS_CORS_HEADERS,
        'Content-Type': 'application/json'
      },
    });
  } catch (err) {
    console.error(err);
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
  const bytes = randomBytes(8);
  const hash = createHash('sha256').update(bytes).digest('hex');
  return hash.slice(0, 12).toUpperCase();
}

async function isCodeUnique(code: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    base('Coupons').select({
      filterByFormula: `{Code} = '${code}'`
    }).firstPage((err, records) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(records!.length === 0);
    });
  });
}

async function saveCouponToAirtable(code: string, status: string): Promise<void> {
  return new Promise((resolve, reject) => {
    base('Coupons').create({
      "Code": code,
      "CreatedAt": new Date().toISOString(),
      "Status": status
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

function isPartiallyDecodedInstruction(instruction: ParsedInstruction | PartiallyDecodedInstruction): instruction is PartiallyDecodedInstruction {
  return 'programId' in instruction && 'accounts' in instruction;
}

// New function to handle webhook for transaction confirmation
export const handleWebhook = async (req: Request): Promise<Response> => {
  try {
    const { signature } = await req.json();
    if (!signature) {
      throw new Error("Missing transaction signature");
    }

    const connection = new Connection(process.env.SOLANA_RPC! || clusterApiUrl("mainnet-beta"));

    // Verify the transaction
    const transaction = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
    });

    if (!transaction) {
      throw new Error("Transaction not found");
    }

    // Verify transaction details
    const instruction = transaction.transaction.message.instructions[0];
    if (isPartiallyDecodedInstruction(instruction)) {
      if (instruction.programId.toString() !== SystemProgram.programId.toString()) {
        throw new Error("Invalid transaction: wrong program ID");
      }

      if (instruction.accounts[1].toString() !== RECIPIENT_ADDRESS.toString()) {
        throw new Error("Invalid transaction: wrong recipient");
      }
    } else {
      throw new Error("Invalid transaction: unexpected instruction format");
    }

    if (
      transaction.meta?.postBalances[1] === undefined ||
      transaction.meta?.preBalances[1] === undefined ||
      transaction.meta.postBalances[1] - transaction.meta.preBalances[1] !== PAYMENT_AMOUNT
    ) {
      throw new Error("Invalid transaction: incorrect amount");
    }

    // Find the pending coupon for this transaction
    const records = await new Promise<Records<FieldSet>>((resolve, reject) => {
      base('Coupons').select({
        filterByFormula: `AND({Status} = 'Pending', {TransactionSignature} = '${signature}')`
      }).firstPage((err, records) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(records || []);
      });
    });

    if (records.length === 0) {
      throw new Error("No pending coupon found for this transaction");
    }

    // Update the coupon status to 'Active'
    await new Promise<void>((resolve, reject) => {
      base('Coupons').update(records[0].id, {
        "Status": "Active"
      }, (err: Error | null) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        ...ACTIONS_CORS_HEADERS,
        'Content-Type': 'application/json'
      },
    });
  } catch (err) {
    console.error(err);
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