import cors = require("cors");

const adminCors = cors({
  origin: JSON.parse(process.env.ADMIN_ORIGIN_WISH_LIST),
  credentials: true,
});
export { adminCors };
