export default function (json, meta) {
  if (!Object.prototype.hasOwnProperty.call(json, "actions")) {
    const e = new Error(`Not found field actions hash ${meta.chain_result}`);
    e.type = "NOT_ACTIONS";
    throw e;
  }
  return json.actions.map((item) => {
    return {
      ...item,
      ...meta,
    };
  });
}
