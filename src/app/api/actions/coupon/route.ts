import {
    ActionPostResponse,
    ACTIONS_CORS_HEADERS,
    createPostResponse,
    ActionGetResponse,
    ActionPostRequest,
  } from "@solana/actions";
  import {
    clusterApiUrl,
    Connection,
    PublicKey,
    Transaction,
    SystemProgram,
    ParsedTransactionWithMeta,
    ParsedInstruction,
    PartiallyDecodedInstruction,
  } from "@solana/web3.js";
  import Airtable from 'airtable';
  import { randomBytes, createHash } from 'crypto';
  
  // Configure Airtable
  const base = new Airtable({ apiKey: process.env.AIRTABLE_COUPON_API_KEY }).base(process.env.AIRTABLE_COUPON_BASE_ID!);
  
  const PAYMENT_AMOUNT = 0.0058 * 1e9; // 0.0058 SOL in lamports
  const RECIPIENT_ADDRESS = new PublicKey("2KsTX7z6AFR5cMjNuiWmrBSPHPk3F3tb7K5Fw14iek3t");
  const MAX_ATTEMPTS = 10;
  
  export const GET = async (req: Request) => {
    const payload: ActionGetResponse = {
      title: "Generate Coupon",
      icon: new URL("/coupon.png", new URL(req.url).origin).toString(),
      description: "Pay 0.0058 SOL to generate a unique coupon code and redeem it for the report on our @Dappshuntbot Telegram channel",
      label: "Generate Coupon",
    };
  
    return new Response(JSON.stringify(payload), {
      headers: {
        ...ACTIONS_CORS_HEADERS,
        'Content-Type': 'application/json'
      },
    });
  };
  
  export const OPTIONS = async (req: Request) => {
    return new Response(null, {
      headers: ACTIONS_CORS_HEADERS,
    });
  };
  
  export const POST = async (req: Request) => {
    const { searchParams } = new URL(req.url);
    const isWebhook = searchParams.get('webhook') === 'true';
  
    if (isWebhook) {
      return handleWebhook(req);
    } else {
      return handleRegularPost(req);
    }
  };
  
  async function handleRegularPost(req: Request) {
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
  
      const code = await generateUniqueCouponCode();
      await saveCouponToAirtable(code);
  
      const payload: ActionPostResponse = await createPostResponse({
        fields: {
          transaction,
          message: `Your coupon code is: ${code}`,
        },
      });
  
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
  }
  
  async function handleWebhook(req: Request) {
    try {
      const { signature } = await req.json();
      if (!signature) {
        throw new Error("Missing transaction signature");
      }
  
      const connection = new Connection(process.env.SOLANA_RPC! || clusterApiUrl("mainnet-beta"));
  
      await verifyTransaction(signature, connection);
  
      const code = await generateUniqueCouponCode();
  
      await saveCouponToAirtable(code);
  
      return new Response(JSON.stringify({ code }), {
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
        status: 500,
        headers: {
          ...ACTIONS_CORS_HEADERS,
          'Content-Type': 'application/json'
        },
      });
    }
  }
  
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
  
  async function saveCouponToAirtable(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      base('Coupons').create({
        "Code": code,
        "CreatedAt": new Date().toISOString(),
        "Status": "Active"
      }, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
  
  function isParsedInstruction(instruction: ParsedInstruction | PartiallyDecodedInstruction): instruction is ParsedInstruction {
    return (instruction as ParsedInstruction).parsed !== undefined;
  }
  
  function isPartiallyDecodedInstruction(instruction: ParsedInstruction | PartiallyDecodedInstruction): instruction is PartiallyDecodedInstruction {
    return (instruction as PartiallyDecodedInstruction).programId !== undefined;
  }
  
  async function verifyTransaction(signature: string, connection: Connection): Promise<void> {
    const confirmation = await connection.confirmTransaction(signature);
    if (confirmation.value.err) {
      throw new Error("Transaction failed to confirm");
    }
  
    const transaction = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!transaction) {
      throw new Error("Transaction not found");
    }
  
    const instruction = transaction.transaction.message.instructions[0];
  
    let programId: string;
    let recipientAddress: string;
  
    if (isPartiallyDecodedInstruction(instruction)) {
      programId = instruction.programId.toBase58();
      recipientAddress = instruction.accounts[1].toBase58();
    } else if (isParsedInstruction(instruction) && instruction.program === 'system' && instruction.parsed.type === 'transfer') {
      programId = SystemProgram.programId.toBase58();
      recipientAddress = instruction.parsed.info.destination;
    } else {
      throw new Error("Unexpected instruction format");
    }
  
    const preBalance = transaction.meta?.preBalances[1];
    const postBalance = transaction.meta?.postBalances[1];
  
    if (preBalance === undefined || postBalance === undefined) {
      throw new Error("Unable to verify transaction amount");
    }
  
    if (
      programId !== SystemProgram.programId.toBase58() ||
      postBalance - preBalance !== PAYMENT_AMOUNT ||
      recipientAddress !== RECIPIENT_ADDRESS.toBase58()
    ) {
      throw new Error("Invalid transaction details");
    }
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
  