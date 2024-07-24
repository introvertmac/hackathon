import { ACTIONS_CORS_HEADERS, ActionsJson } from "@solana/actions";

export const GET = async () => {
  const payload: ActionsJson = {
    rules: [
      {
        pathPattern: "/analyze",
        apiPath: "/api/actions/analyze",
      },
      {
        pathPattern: "/coupon",
        apiPath: "/api/actions/coupon",
      },
      {
        pathPattern: "/job",
        apiPath: "/api/actions/job",
      },
    ],
  };

  return Response.json(payload, {
    headers: ACTIONS_CORS_HEADERS,
  });
};

export const OPTIONS = GET;