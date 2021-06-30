import moment from "moment";
import db from "../../models/db";

const Data = db.sequelize.define("data", {
  chain_id: {
    type: db.Sequelize.INTEGER,
  },
  sensor_id: {
    type: db.Sequelize.STRING,
  },
  model: {
    type: db.Sequelize.INTEGER,
  },
  data: {
    type: db.Sequelize.STRING,
  },
  geo: {
    type: db.Sequelize.STRING,
  },
  timestamp: {
    type: db.Sequelize.INTEGER,
  },
});

export default Data;

export async function getAll() {
  const model2 = await getLastRecordByModel(2);
  const model3 = await getAllByModel(3);
  return [...model2, ...model3];
}

export async function getLastRecordByModel(model) {
  const sql = `
    select
      max(t1.id),
      t1.sensor_id,
      t1.model,
      t1.data,
      t1.geo,
      t1.timestamp,
      t2.sender as chain_sender,
      t2.timechain as chain_time
    from data as t1
    left join chains as t2 on t2.id = t1.chain_id
    where t2.timechain >= :timechain and t1.model=model
    group by t1.sensor_id, t1.timestamp
  `;
  const replacements = {
    timechain: moment().subtract(1, "day").format("x"),
    model: model,
  };
  const rows = await db.sequelize.query(sql, {
    replacements,
    type: db.sequelize.QueryTypes.SELECT,
  });
  return rows.map((row) => {
    const data = JSON.parse(row.data);
    return {
      sensor_id: row.sensor_id,
      sender: row.chain_sender,
      model: row.model,
      geo: row.geo,
      data: data,
      timestamp: row.timestamp,
    };
  });
}

export async function getAllByModel(model) {
  const sql = `
    select
      max(t1.id),
      t1.sensor_id,
      t1.model,
      t1.data,
      t1.geo,
      t1.timestamp,
      t2.sender as chain_sender,
      t2.timechain as chain_time
    from data as t1
    left join chains as t2 on t2.id = t1.chain_id
    where t2.timechain >= :timechain and t1.model=model
  `;
  const replacements = {
    timechain: moment().subtract(1, "day").format("x"),
    model: model,
  };
  const rows = await db.sequelize.query(sql, {
    replacements,
    type: db.sequelize.QueryTypes.SELECT,
  });
  return rows.map((row) => {
    const data = JSON.parse(row.data);
    return {
      sensor_id: row.sensor_id,
      sender: row.chain_sender,
      model: row.model,
      geo: row.geo,
      data: data,
      timestamp: row.timestamp,
    };
  });
}

export async function getByType(type) {
  const sql = `
    select
      max(t1.id),
      t1.sensor_id,
      t1.model,
      t1.data,
      t1.geo,
      t1.timestamp,
      t2.sender as chain_sender,
      t2.timechain as chain_time
    from data as t1
    left join chains as t2 on t2.id = t1.chain_id
    where t2.timechain >= :timechain
  `;
  const replacements = {
    timechain: moment().subtract(1, "day").format("x"),
  };
  const rows = await db.sequelize.query(sql, {
    replacements,
    type: db.sequelize.QueryTypes.SELECT,
  });
  return rows.map((row) => {
    const data = JSON.parse(row.data);
    if (data[type]) {
      return {
        sensor_id: row.sensor_id,
        sender: row.chain_sender,
        model: row.model,
        geo: row.geo,
        value: data[type],
        data: data,
        timestamp: row.timestamp,
      };
    }
    return false;
  });
}

export async function getBySensor(sensor_id) {
  const sql = `
    select
      t1.data,
      t1.timestamp,
      t2.timechain as chain_time
    from data as t1
    left join chains as t2 on t2.id = t1.chain_id
    where t1.sensor_id = :sensor_id and t2.timechain >= :timechain
    group by t1.timestamp
  `;
  const replacements = {
    sensor_id: sensor_id,
    timechain: moment().subtract(1, "day").format("x"),
  };
  const rows = await db.sequelize.query(sql, {
    replacements,
    type: db.sequelize.QueryTypes.SELECT,
  });
  return rows.map((row) => {
    const data = JSON.parse(row.data);
    return {
      data: data,
      timestamp: row.timestamp,
    };
  });
}

export async function getHistoryByDate(from, to) {
  const sql = `
    select
      t1.sensor_id,
      t2.sender as chain_sender,
      t1.model,
      t1.data,
      t1.geo,
      t1.timestamp
    from data as t1
    left join chains as t2 on t2.id = t1.chain_id
    where t1.timestamp between :from and :to
    group by t1.sensor_id, t1.timestamp
    order by t1.timestamp asc
  `;
  const replacements = {
    from: from,
    to: to,
  };
  const rows = await db.sequelize.query(sql, {
    replacements,
    type: db.sequelize.QueryTypes.SELECT,
  });
  const result = {};
  rows.forEach((row) => {
    const data = JSON.parse(row.data);
    if (!Object.prototype.hasOwnProperty.call(result, row.sensor_id)) {
      result[row.sensor_id] = [];
    }
    result[row.sensor_id].push({
      sensor_id: row.sensor_id,
      sender: row.sender,
      model: row.model,
      data: data,
      geo: row.geo,
      timestamp: Number(row.timestamp),
    });
  });
  return result;
}
