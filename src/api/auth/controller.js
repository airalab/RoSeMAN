import { signatureVerify } from "@polkadot/util-crypto";
import Subscription from "../../models/subscription";

export default {
  async auth(req, res) {
    try {
      const { isValid } = signatureVerify(
        req.body.message,
        req.body.signature,
        req.body.signer
      );

      if (isValid) {
        const subscription = await Subscription.findOne({
          account: req.body.message,
        }).lean();
        if (subscription) {
          res.send({
            result: true,
          });
        } else {
          res.send({
            error: `Error: Not found account ${req.body.message}`,
          });
        }
      } else {
        res.send({
          error: `Error: Signature verification failed`,
        });
      }
    } catch (error) {
      res.send({
        error: error.message,
      });
    }
  },
};
