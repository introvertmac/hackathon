import {
  ActionPostResponse,
  ACTIONS_CORS_HEADERS,
  createPostResponse,
  ActionGetResponse,
  ActionPostRequest,
} from "@solana/actions";
import {
  Connection,
  PublicKey,
  clusterApiUrl,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

const generateSVG = (avatar: string, traits: string[], transactionCount: number, tokenCount: number) => {
  const colors: { [key: string]: string } = {
    "Solana Newbie": "#9945FF",
    "Active Hunter": "#14F195",
    "Token Collector": "#00C2FF",
    "NFT Enthusiast": "#FF9C00",
    "DeFi Explorer": "#FF3B3B",
  };

  const color = colors[avatar] || "#9945FF";

  return `
    <svg width="300" height="300" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      <circle cx="150" cy="100" r="80" fill="${color}"/>
      <text x="150" y="105" font-family="Arial" font-size="16" fill="white" text-anchor="middle">${avatar}</text>
      <text x="10" y="200" font-family="Arial" font-size="12" fill="black">Transactions: ${transactionCount}</text>
      <text x="10" y="220" font-family="Arial" font-size="12" fill="black">Tokens: ${tokenCount}</text>
      <text x="10" y="240" font-family="Arial" font-size="12" fill="black">Traits: ${traits.join(', ')}</text>
    </svg>
  `;
};

export const GET = async (req: Request) => {
  const payload: ActionGetResponse = {
    title: "Wallet Analyzer",
    icon: new URL("/wallet.JPG", new URL(req.url).origin).toString(),
    description: "Analyze your wallet and get a personalized avatar!",
    label: "Analyze Wallet",
  };

  return Response.json(payload, {
    headers: ACTIONS_CORS_HEADERS,
  });
};

export const OPTIONS = GET;

export const POST = async (req: Request) => {
  try {
    const body: ActionPostRequest = await req.json();
    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch (err) {
      return new Response('Invalid "account" provided', {
        status: 400,
        headers: ACTIONS_CORS_HEADERS,
      });
    }

    const connection = new Connection(clusterApiUrl("mainnet-beta"));

    // Analyze transactions (limit to 100 for a more comprehensive analysis)
    const transactions = await connection.getSignaturesForAddress(account, { limit: 100 });
    
    // Analyze token holdings
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(account, { programId: TOKEN_PROGRAM_ID });

    // Trait analysis
    let avatar = "Solana Newbie";
    let traits = [];

    if (transactions.length >= 50) {
      avatar = "Active hunter";
      traits.push("High transaction volume");
    }

    if (tokenAccounts.value.length > 5) {
      avatar = "Token Collector";
      traits.push("Diverse token portfolio");
    }

    const nftTransactions = transactions.filter(tx => 
      tx.memo?.toLowerCase().includes("nft") || 
      tx.memo?.toLowerCase().includes("metaplex")
    );

    if (nftTransactions.length > 0) {
      avatar = "NFT Enthusiast";
      traits.push("Interested in digital collectibles");
    }

    const defiTransactions = transactions.filter(tx =>
      tx.memo?.toLowerCase().includes("swap") ||
      tx.memo?.toLowerCase().includes("yield") ||
      tx.memo?.toLowerCase().includes("farm")
    );

    if (defiTransactions.length > 0) {
      avatar = "DeFi Explorer";
      traits.push("Engaged in decentralized finance");
    }

    // Create a transaction with a fee of 0.001 SOL
    const feeAmount = 0.001 * LAMPORTS_PER_SOL;
    const feeRecipient = new PublicKey("2KsTX7z6AFR5cMjNuiWmrBSPHPk3F3tb7K5Fw14iek3t");
    
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: account,
        toPubkey: feeRecipient,
        lamports: feeAmount,
      })
    );

    // Set the fee payer and get the latest blockhash
    transaction.feePayer = account;
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    // Generate custom SVG
    const svg = generateSVG(avatar, traits, transactions.length, tokenAccounts.value.length);
    const svgBase64 = Buffer.from(svg).toString('base64');
    const customIcon = `data:image/svg+xml;base64,${svgBase64}`;

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        transaction,
        message: `Your wallet avatar is: ${avatar}\n\nTraits:\n${traits.join("\n- ")}`,
      },
    });

    // Modify the payload to include our custom icon
    const modifiedPayload = {
      ...payload,
      icon: customIcon,
    };

    return Response.json(modifiedPayload, {
      headers: ACTIONS_CORS_HEADERS,
    });
  } catch (err) {
    console.error(err);
    return new Response("An error occurred during analysis", {
      status: 500,
      headers: ACTIONS_CORS_HEADERS,
    });
  }
};
