import { loadEnv } from "../env";

const env = loadEnv();

if (!env.DISCORD_APPLICATION_ID) {
  console.error("missing environment: DISCORD_APPLICATION_ID");
  process.exit(1);
}

const permissions = 1024 + 2048 + 16384; // view channel + send messages + embed links
const url =
  `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_APPLICATION_ID}` +
  `&scope=bot%20applications.commands&permissions=${permissions}`;

console.log("초대 URL (새 Discord application):");
console.log(url);
