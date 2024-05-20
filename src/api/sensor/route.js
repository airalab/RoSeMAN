import express from "express";
import controller from "./controller";

const router = express.Router();

router.get("/cities/:start?/:end?", controller.cities);
router.get("/last/:start/:end", controller.last);
router.get("/messages/:start/:end", controller.messages);
router.get("/max/:start/:end/:type", controller.max);
router.get("/csv/:start/:end/:city", controller.csv);
router.get("/:sensor/:start/:end", controller.sensor);

export default router;
