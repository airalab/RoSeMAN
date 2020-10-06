import axios from "axios";

export async function cat(hash, options) {
  const res = await axios.get(
    `https://gateway.pinata.cloud/ipfs/${hash}`,
    options
  );
  return JSON.stringify(res.data);
}
