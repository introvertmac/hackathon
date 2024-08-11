import {
    ActionPostResponse,
    ACTIONS_CORS_HEADERS,
    createPostResponse,
    ActionGetResponse,
    ActionPostRequest,
  } from "@solana/actions";
  import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Connection, clusterApiUrl } from "@solana/web3.js";
  import Airtable, { FieldSet, Record } from 'airtable';
  
  // Configure Airtable
  if (!process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || !process.env.Hackathon_BASE_ID) {
    throw new Error('Airtable configuration is missing');
  }
  
  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN });
  const base = airtable.base(process.env.Hackathon_BASE_ID);
  const table = base('Users');
  
  // Create a Solana connection
  const connection = new Connection(clusterApiUrl("mainnet-beta"));
  
  type Skill = 'Frontend' | 'Backend' | 'Design' | 'Any';
  
  interface UserProfile {
    discordUsername: string;
    skill: Skill;
    lookingFor: Skill;
  }
  
  export const GET = async (req: Request): Promise<Response> => {
    const payload: ActionGetResponse = {
      title: "Hackathon Buddy Finder",
      icon: new URL("/jack.jpeg", new URL(req.url).origin).toString(),
      description: "Enter your details in the format: yourskill:discordusername:find:desiredskill (e.g., frontend:user123:find:backend)",
      label: "Find Buddy",
      links: {
        actions: [
          {
            label: "Find Buddy",
            href: `${new URL(req.url).origin}/api/actions/hackathon?input={input}`,
            parameters: [
              {
                name: "input",
                label: "Enter in format: yourskill:discordusername:find:desiredskill",
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
  
  export const POST = async (req: Request): Promise<Response> => {
    try {
      const body: ActionPostRequest = await req.json();
      const { account } = body;
  
      const url = new URL(req.url);
      const input = url.searchParams.get('input');
  
      if (!input || !account) {
        throw new Error("Missing required fields: input or account");
      }
  
      // Validate wallet address
      let walletAddress: PublicKey;
      try {
        walletAddress = new PublicKey(account);
      } catch (err) {
        throw new Error("Invalid wallet address provided");
      }
  
      const user = parseUserInput(input);
      if (!user) {
        throw new Error("Invalid input format. Please use: yourskill:discordusername:find:desiredskill");
      }
  
      const result = await matchHackathonBuddy(user);
  
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
  
      const messageText = `${result} Estimated transaction fee: ${(estimatedFee / LAMPORTS_PER_SOL).toFixed(6)} SOL.`;
  
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
      console.error("Error in Hackathon Buddy Finder:", err);
      let message = "An unexpected error occurred while processing your request";
      if (err instanceof Error) message = err.message;
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { ...ACTIONS_CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  };
  
  function parseUserInput(input: string): UserProfile | null {
    try {
      const parts = input.split(':');
      if (parts.length !== 4) throw new Error("Invalid input format");
  
      const [skill, discordUsername, action, lookingFor] = parts.map(part => part.trim());
      if (action.toLowerCase() !== 'find') throw new Error("Invalid action");
  
      if (!isValidSkill(skill) || !isValidSkill(lookingFor)) {
        throw new Error("Invalid skill");
      }
  
      return {
        discordUsername,
        skill: capitalizeFirstLetter(skill) as Skill,
        lookingFor: capitalizeFirstLetter(lookingFor) as Skill,
      };
    } catch (error) {
      console.error("Error parsing user input:", error);
      return null;
    }
  }
  
  function isValidSkill(skill: string): boolean {
    const validSkills: Skill[] = ['Frontend', 'Backend', 'Design', 'Any'];
    return validSkills.includes(capitalizeFirstLetter(skill) as Skill);
  }
  
  function capitalizeFirstLetter(string: string): string {
    return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
  }
  
  async function matchHackathonBuddy(user: UserProfile): Promise<string> {
    try {
      // Check if user already exists
      const existingUser = await getUserByDiscordUsername(user.discordUsername);
      if (existingUser) {
        if (existingUser.get('Match Status') === 'Matched') {
          const partnerId = existingUser.get('Partner ID') as string;
          const partner = await table.find(partnerId);
          return `You already have a match! Your hackathon buddy is ${partner.get('Discord Username')} (${partner.get('Skill')}).`;
        } else {
          // Update existing user's preferences
          await updateUserProfile(existingUser.id, user);
        }
      } else {
        // Store new user profile
        await storeUserProfile(user);
      }
  
      // Find a new match
      const match = await findMatch(user);
  
      if (match) {
        // Update both users with their partner IDs
        await updateMatchedUsers(existingUser ? existingUser.id : (await getUserByDiscordUsername(user.discordUsername))!.id, match.id);
        return `Match found! Your hackathon buddy is ${match.get('Discord Username')} (${match.get('Skill')}).`;
      } else {
        return "No match found yet. We've added you to our database and will notify you when a match is found.";
      }
    } catch (error) {
      console.error("Error in matchHackathonBuddy:", error);
      throw error;
    }
  }
  
  async function getUserByDiscordUsername(discordUsername: string): Promise<Record<FieldSet> | null> {
    try {
      const records = await table.select({
        filterByFormula: `LOWER({Discord Username}) = LOWER('${discordUsername}')`,
      }).firstPage();
  
      return records.length > 0 ? records[0] : null;
    } catch (error) {
      console.error("Error getting user by Discord username:", error);
      throw new Error("Failed to retrieve user information");
    }
  }
  
  async function findMatch(user: UserProfile): Promise<Record<FieldSet> | null> {
    try {
      const potentialMatches = await table.select({
        filterByFormula: `AND(
          LOWER({Discord Username}) != LOWER('${user.discordUsername}'),
          OR(
            {Skill} = '${user.lookingFor}',
            {Skill} = 'Any',
            '${user.lookingFor}' = 'Any'
          ),
          OR(
            {Looking For} = '${user.skill}',
            {Looking For} = 'Any',
            '${user.skill}' = 'Any'
          ),
          {Partner ID} = '',
          {Match Status} = 'Unmatched'
        )`,
      }).firstPage();
  
      return potentialMatches.length > 0 ? potentialMatches[0] : null;
    } catch (error) {
      console.error("Error finding match:", error);
      throw new Error("Failed to find a match");
    }
  }
  
  async function storeUserProfile(user: UserProfile): Promise<void> {
    try {
      await table.create([
        {
          fields: {
            'Discord Username': user.discordUsername,
            'Skill': user.skill,
            'Looking For': user.lookingFor,
            'Partner ID': '',
            'Match Status': 'Unmatched',
            'Notes': '',
          },
        },
      ]);
    } catch (error) {
      console.error("Error storing user profile:", error);
      throw new Error("Failed to store user profile");
    }
  }
  
  async function updateUserProfile(recordId: string, user: UserProfile): Promise<void> {
    try {
      await table.update([
        {
          id: recordId,
          fields: {
            'Skill': user.skill,
            'Looking For': user.lookingFor,
            'Match Status': 'Unmatched',
            'Partner ID': '',
          },
        },
      ]);
    } catch (error) {
      console.error("Error updating user profile:", error);
      throw new Error("Failed to update user profile");
    }
  }
  
  async function updateMatchedUsers(user1Id: string, user2Id: string): Promise<void> {
    try {
      await table.update([
        { 
          id: user1Id, 
          fields: { 
            'Partner ID': user2Id,
            'Match Status': 'Matched',
          } 
        },
        { 
          id: user2Id, 
          fields: { 
            'Partner ID': user1Id,
            'Match Status': 'Matched',
          } 
        },
      ]);
    } catch (error) {
      console.error("Error updating matched users:", error);
      throw new Error("Failed to update matched users");
    }
  }