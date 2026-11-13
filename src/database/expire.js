import { expireReservations } from "../services/orderService.js";
import { pool } from "./pool.js";
try {
  let count = 0,
    batch;
  do {
    batch = await expireReservations();
    count += batch;
  } while (batch === 100);
  console.info(`Reservas expiradas: ${count}`);
} finally {
  await pool.end();
}
