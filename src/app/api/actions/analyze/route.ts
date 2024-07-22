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

interface Achievement {
  name: string;
  description: string;
  color: string;
}

const ACHIEVEMENTS: Achievement[] = [
  { name: "Early Adopter", description: "Active before 2022", color: "#FFD700" },
  { name: "Diamond Hands", description: "Held tokens for over a year", color: "#B9F2FF" },
  { name: "Yield Farmer", description: "Active in DeFi protocols", color: "#90EE90" },
  { name: "NFT Collector", description: "Owns multiple NFTs", color: "#FFA500" },
  { name: "Governance Participant", description: "Voted in DAO proposals", color: "#BA55D3" },
];

const generateSVG = (avatar: string, traits: string[], achievements: Achievement[], transactionCount: number, tokenCount: number) => {
  const avatarColors: { [key: string]: string } = {
    "Solana Newbie": "#9945FF",
    "Active Hunter": "#14F195",
    "Token Collector": "#00C2FF",
    "NFT Enthusiast": "#FF9C00",
    "DeFi Explorer": "#FF3B3B",
  };

  const avatarColor = avatarColors[avatar] || "#9945FF";

  let svg = `
    <svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      <circle cx="200" cy="120" r="100" fill="${avatarColor}"/>
      <text x="200" y="130" font-family="Arial" font-size="24" fill="white" text-anchor="middle">${avatar}</text>
      <text x="10" y="240" font-family="Arial" font-size="16" fill="black">Transactions: ${transactionCount}</text>
      <text x="10" y="260" font-family="Arial" font-size="16" fill="black">Tokens: ${tokenCount}</text>
      <text x="10" y="280" font-family="Arial" font-size="16" fill="black">Traits: ${traits.join(', ')}</text>
  `;

  achievements.forEach((achievement, index) => {
    const y = 320 + index * 25;
    svg += `
      <rect x="10" y="${y}" width="20" height="20" fill="${achievement.color}"/>
      <text x="40" y="${y + 15}" font-family="Arial" font-size="14" fill="black">${achievement.name}</text>
    `;
  });

  svg += '</svg>';
  return svg;
};

export const GET = async (req: Request) => {
  const payload: ActionGetResponse = {
    title: "Enhanced Wallet Analyzer",
    icon: new URL("/wallet.JPG", new URL(req.url).origin).toString(),
    description: "Analyze your wallet, get a personalized avatar, and earn achievements!",
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

    // Analyze transactions
    const transactions = await connection.getSignaturesForAddress(account, { limit: 1000 });
    
    // Analyze token holdings
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(account, { programId: TOKEN_PROGRAM_ID });

    // Trait and achievement analysis
    let avatar = "Solana Newbie";
    let traits = [];
    let userAchievements: Achievement[] = [];

    if (transactions.length >= 100) {
      avatar = "Active Hunter";
      traits.push("High transaction volume");
    }

    if (tokenAccounts.value.length > 10) {
      avatar = "Token Collector";
      traits.push("Diverse token portfolio");
    }

    const nftTransactions = transactions.filter(tx => 
      tx.memo?.toLowerCase().includes("nft") || 
      tx.memo?.toLowerCase().includes("metaplex")
    );

    if (nftTransactions.length > 5) {
      avatar = "NFT Enthusiast";
      traits.push("Digital art collector");
      userAchievements.push(ACHIEVEMENTS.find(a => a.name === "NFT Collector")!);
    }

    const defiTransactions = transactions.filter(tx =>
      tx.memo?.toLowerCase().includes("swap") ||
      tx.memo?.toLowerCase().includes("yield") ||
      tx.memo?.toLowerCase().includes("farm")
    );

    if (defiTransactions.length > 10) {
      avatar = "DeFi Explorer";
      traits.push("DeFi power user");
      userAchievements.push(ACHIEVEMENTS.find(a => a.name === "Yield Farmer")!);
    }

    // Check for early adopter
    const oldestTransaction = transactions[transactions.length - 1];
    if (oldestTransaction && new Date(oldestTransaction.blockTime! * 1000) < new Date('2022-01-01')) {
      userAchievements.push(ACHIEVEMENTS.find(a => a.name === "Early Adopter")!);
    }

    // Check for diamond hands (simplified version)
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const longHeldTokens = tokenAccounts.value.filter(account => 
      new Date(account.account.data.parsed.info.tokenAmount.lastUpdatedAt * 1000) < new Date(oneYearAgo)
    );
    if (longHeldTokens.length > 0) {
      userAchievements.push(ACHIEVEMENTS.find(a => a.name === "Diamond Hands")!);
    }

    // Check for governance participation (simplified version)
    const governanceTransactions = transactions.filter(tx =>
      tx.memo?.toLowerCase().includes("vote") ||
      tx.memo?.toLowerCase().includes("proposal")
    );
    if (governanceTransactions.length > 0) {
      userAchievements.push(ACHIEVEMENTS.find(a => a.name === "Governance Participant")!);
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
    const svg = generateSVG(avatar, traits, userAchievements, transactions.length, tokenAccounts.value.length);
    const svgBase64 = Buffer.from(svg).toString('base64');
    const customIcon = `data:image/svg+xml;base64,${svgBase64}`;

    // Calculate total SOL balance
    const balance = await connection.getBalance(account);
    const solBalance = balance / LAMPORTS_PER_SOL;

    // Format the message with more detailed statistics and achievements
    const message = `
👤 Avatar: ${avatar}

🏆 Achievements:
${userAchievements.map(a => `• ${a.name}: ${a.description}`).join('\n')}

🏷️ Traits:
${traits.map(trait => `• ${trait}`).join('\n')}

📊 Statistics:
- SOL Balance: ${solBalance.toFixed(4)} SOL

🌟 Rarity Score: ${(userAchievements.length * 20 + traits.length * 10 + Math.min(transactions.length / 10, 100)).toFixed(2)}
    `.trim();

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        transaction,
        message,
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