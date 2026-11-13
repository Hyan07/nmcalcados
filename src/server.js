import { app } from "./app.js";
import { env } from "./config/env.js";

app.listen(env.port, () => console.info(`N&M Calçados em ${env.origin}`));
