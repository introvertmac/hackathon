import { ACTIONS_CORS_HEADERS, ActionsJson } from "@solana/actions";
import { NextResponse } from 'next/server';

export const GET = async () => {
  try {
    const payload: ActionsJson = {
      rules: [
        {
          pathPattern: "/hackathon",
          apiPath: "/api/actions/hackathon",
        },
        // Idempotent rule as the fallback
        {
          pathPattern: "/api/actions/**",
          apiPath: "/api/actions/**",
        },
      ],
    };

    return NextResponse.json(payload, {
      headers: ACTIONS_CORS_HEADERS,
    });
  } catch (error) {
    console.error("Error generating actions.json:", error);
    return NextResponse.json({ error: "Internal Server Error" }, {
      status: 500,
      headers: ACTIONS_CORS_HEADERS,
    });
  }
};

// DO NOT FORGET TO INCLUDE THE `OPTIONS` HTTP METHOD
// THIS WILL ENSURE CORS WORKS FOR BLINKS
export const OPTIONS = GET;