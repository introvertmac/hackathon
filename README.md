# Hackathon Buddy Finder Blink

A Solana blink to help hackathon participants find coding partners based on their skills.

## Airtable Configuration

1. Create a new Airtable base.
2. In the base, create a table named "Users" with the following fields:
   - Discord Username (Single line text)
   - Skill (Single select: Frontend, Backend, Design, Any)
   - Looking For (Single select: Frontend, Backend, Design, Any)
   - Partner ID (Single line text)
   - Match Status (Single select: Matched, Unmatched)
   - Verification Status (Single select: Verified, Unverified)
   - Notes (Long text)

## Environment Variables

Set the following environment variables:

- `AIRTABLE_PERSONAL_ACCESS_TOKEN`: Your Airtable Personal Access Token
- `Hackathon_BASE_ID`: The ID of your Airtable base
- `SOLANA_RPC`: (Optional) Custom Solana RPC URL. If not set, it defaults to the public mainnet-beta endpoint.

## User Input Format

Users should input their information in the following format:

```
[username] [skill initial] > [desired skill initial]
```

- Username: Discord username
- Skill initial: F (Frontend), B (Backend), D (Design), A (Any)
- Desired skill initial: F, B, D, or A

Example: `JohnDoe F > B`

## Matching Algorithm

1. Parse user input to extract Discord username, current skill, and desired skill.
2. Check if the user already exists in the Airtable:
   - If exists and matched, return the existing match.
   - If exists and unmatched, update the user's preferences.
   - If doesn't exist, create a new user profile.
3. Search for potential matches based on the following criteria:
   - User's desired skill matches potential match's skill (or either is "Any")
   - Potential match's desired skill matches user's skill (or either is "Any")
   - Potential match is unmatched
4. If a match is found:
   - Update both users' statuses to "Matched"
   - Set Partner IDs for both users
   - Return the match information
5. If no match is found, inform the user they've been added to the database.

## Verification Status

- New users are automatically set as "Unverified"
- Only Airtable admins can change a user's status to "Verified"
- The verification status is included in the match result message

## Note

Match results depend on available users in the database. Initial matches may be test or unverified users until the user base grows.