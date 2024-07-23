import {
    ActionPostResponse,
    ACTIONS_CORS_HEADERS,
    createPostResponse,
    ActionGetResponse,
    ActionPostRequest,
  } from "@solana/actions";
  import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Connection, clusterApiUrl } from "@solana/web3.js";
  import Airtable from 'airtable';
  
  // Configure Airtable
  if (!process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || !process.env.AIRTABLE_BASE_ID) {
    throw new Error('Airtable configuration is missing');
  }
  
  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN });
  const base = airtable.base(process.env.AIRTABLE_BASE_ID);
  
  // Create a Solana connection
  const connection = new Connection(clusterApiUrl("mainnet-beta"));
  
  export const GET = async (req: Request) => {
    const payload: ActionGetResponse = {
      title: "We are Hiring Devs",
      icon: new URL("/job.JPG", new URL(req.url).origin).toString(),
      description: "Submit your Superteam or GitHub profile to create awesome blinks!",
      label: "Submit Profile",
      links: {
        actions: [
          {
            label: "Submit Profile",
            href: `${new URL(req.url).origin}/api/actions/job?profileLink={profileLink}`,
            parameters: [
              {
                name: "profileLink",
                label: "link of Superteam Earn/ GitHub",
                required: true,
              },
            ],
          },
        ],
      },
    };
  
    return Response.json(payload, {
      headers: ACTIONS_CORS_HEADERS,
    });
  };
  
  export const OPTIONS = GET;
  
  export const POST = async (req: Request) => {
    try {
      const body: ActionPostRequest = await req.json();
      const { account } = body;
  
      const url = new URL(req.url);
      const profileLink = url.searchParams.get('profileLink');
  
      if (!profileLink || !account) {
        throw new Error("Missing required fields");
      }
  
      // Validate wallet address
      let walletAddress: PublicKey;
      try {
        walletAddress = new PublicKey(account);
      } catch (err) {
        throw new Error("Invalid wallet address");
      }
  
      let superteamUsername = '';
      let githubUsername = '';
  
      // Validate and extract profile link
      if (validateSuperteamProfile(profileLink)) {
        superteamUsername = extractSuperteamUsername(profileLink);
      } else if (validateGithubProfile(profileLink)) {
        githubUsername = extractGithubUsername(profileLink);
      } else {
        throw new Error("Invalid profile link");
      }
  
      // Check if the profile already exists
      const existingProfile = await checkExistingProfile(walletAddress.toString());
      if (existingProfile) {
        return new Response(JSON.stringify({ error: "Profile already exists for this wallet address" }), {
          status: 400,
          headers: { ...ACTIONS_CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
  
      // Save to Airtable
      await saveToAirtable(superteamUsername, githubUsername, walletAddress.toString());
  
      // Create a transaction with a dummy instruction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: walletAddress,
          toPubkey: walletAddress,
          lamports: 0,
        })
      );
  
      // Set the fee payer to the user's wallet address
      transaction.feePayer = walletAddress;
  
      // Estimate transaction fee
      const { blockhash } = await connection.getRecentBlockhash();
      transaction.recentBlockhash = blockhash;
  
      // Serialize the transaction to get the message
      const message = transaction.compileMessage();
      const estimatedFeeResponse = await connection.getFeeForMessage(message);
  
      if (estimatedFeeResponse.value === null) {
        throw new Error("Failed to estimate the transaction fee");
      }
  
      const estimatedFee = estimatedFeeResponse.value;
  
      // Prepare success message
      const messageText = `Your application has been received. Estimated transaction fee: ${estimatedFee / LAMPORTS_PER_SOL} SOL. Thank you for submitting!`;
  
      const payload: ActionPostResponse = await createPostResponse({
        fields: {
          transaction,
          message: messageText,
        },
      });
  
      return Response.json(payload, {
        headers: ACTIONS_CORS_HEADERS,
      });
    } catch (err) {
      console.error(err);
      let message = "An unknown error occurred";
      if (err instanceof Error) message = err.message;
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { ...ACTIONS_CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  };
  
  function validateSuperteamProfile(url: string): boolean {
    return /^https:\/\/earn\.superteam\.fun\/t\/[a-zA-Z0-9_-]+\/?$/.test(url);
  }
  
  function validateGithubProfile(url: string): boolean {
    return /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/?$/.test(url);
  }
  
  function extractSuperteamUsername(url: string): string {
    const match = url.match(/\/t\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
  }
  
  function extractGithubUsername(url: string): string {
    const match = url.match(/github\.com\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
  }
  
  async function checkExistingProfile(walletAddress: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      base('Job Board').select({
        filterByFormula: `{Wallet Address} = '${walletAddress}'`
      }).firstPage((err, records) => {
        if (err) {
          console.error(err);
          return reject(err);
        }
        resolve(!!records && records.length > 0);
      });
    });
  }
  
  async function saveToAirtable(superteamUsername: string, githubUsername: string, walletAddress: string) {
    return new Promise((resolve, reject) => {
      base('Job Board').create([
        {
          fields: {
            'Superteam Username': superteamUsername,
            'GitHub Username': githubUsername,
            'Wallet Address': walletAddress,
            'Submission Date': new Date().toISOString(),
          },
        },
      ], function(err, records) {
        if (err) {
          console.error(err);
          return reject(err);
        }
        resolve(records);
      });
    });
  }
  