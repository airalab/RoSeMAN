import express from "express";
import controller from "./controller";

const router = express.Router();

router.get("/cities/:start?/:end?", controller.cities);
router.get("/last/:start/:end", controller.last);
router.get("/last/:start/:end/:type", controller.lastType);
router.get("/messages/:start/:end", controller.messages);
router.get("/max/:start/:end/:type", controller.max);
router.get("/csv/:start/:end/:city", controller.csv);
router.get("/json/:start?/:end?", controller.json);
router.get("/measurements/:start/:end", controller.measurements);
router.get("/info/:sensor", controller.info);
router.get("/:sensor/:start/:end", controller.sensor);

export default router;
