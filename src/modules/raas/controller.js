import {
  getCountSuccess,
  getCountError,
  getLastSuccess,
  getCountTxSuccess,
  getLastTxTime,
} from "./table";

export default {
  async all(req, res) {
    try {
      const success = await getCountSuccess();
      const error = await getCountError();
      const countTx = await getCountTxSuccess();
      const last = await getLastSuccess(10);
      const lastTxTime = await getLastTxTime();
      const cost = (success * 0.05).toFixed(2);

      res.send({
        result: {
          success: success,
          error: error,
          countTx: countTx,
          cost: cost,
          last: last,
          lastTxTime,
        },
      });
      return;
    } catch (error) {
      console.log(error);
      res.send({
        error: "Error",
      });
    }
  },
};
