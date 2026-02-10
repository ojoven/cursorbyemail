// ngrok-version.js (ESM)
import ngrok from "ngrok";

(async () => {
  const v = await ngrok.getVersion();
  console.log(v);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
