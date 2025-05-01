const DBH = require("./database.js")
const cronJob = require("cron").CronJob

var object_type = {}
var object_values = {}

DBH.batch_device_select("realtime_table", function (rows) {
  rows.forEach((row) => {
    object_type[row["object_name"]] = row["object_type"]
    object_values[row["object_name"]] = []
  })
  // console.log(object_values)
})

const jobs = [
  {
    pattern: "0 0 */1 * * *",
    message: "this runs every 1 hour",
    get: "10minute",
    table: "1hour",
    time_interval: "1 hour",
  },
  {
    pattern: "0 0 0 */1 * *",
    message: "this runs every 1 day",
    get: "1hour",
    table: "1day",
    time_interval: "1 day",
  },
  {
    pattern: "0 0 0 1 */1 *",
    message: "this runs every 1 month",
    get: "1day",
    table: "1month",
    time_interval: "1 month",
  },
  {
    pattern: "0 0 0 1 1 *",
    message: "this runs every 1 year",
    get: "1month",
    table: "1year",
    time_interval: "1 year",
  },
]

new cronJob("*/10 * * * * *", function () {
  try {
    console.log("this runs every 10 seconds", new Date())
    DBH.batch_device_select("realtime_table", function (rows) {
      rows.forEach((row) => {
        console.log(row["object_name"])
        object_values[row["object_name"]].push(row["log_value"])
      })
    })
  } catch (e) {
    console.log("10second batch error : ", e)
  }
  // setTimeout(()=>console.log('after timeout'),11000)
}).start()

new cronJob("0 */10 * * * *", () => {
  try {
    console.log("this runs every 10 minute", new Date())
    for (const [key, value] of Object.entries(object_values)) {
      const sum = value.reduce((a, b) => a + b, 0)
      const avg = sum / value.length || 0
      DBH.batch_insert("10minute", key, avg)
      object_values[key] = []
    }
  } catch (e) {
    console.log("10 minte batch error : ", e)
  }
}).start()

jobs.forEach((job) => {
  new cronJob(job.pattern, () => {
    try {
      console.log(job.message, new Date())
      for (const [key, value] of Object.entries(object_values)) {
        DBH.batch_select(job.get, key, job.time_interval, function (rows) {
          if (rows[0]["avg(log_value)"] != null) {
            DBH.batch_insert(job.table, key, rows[0]["avg(log_value)"])
          }
        })
      }
    } catch (e) {
      console.log(job.table, "batch error: ", e)
    }
  }).start()
})

//아직 record_type에 대한 처리는 안함 -> acc/real

const log_list = [
  "bacnet-err.log",
  "batch-err.log",
  "database-err.log",
  "modbus-err.log",
]
new cronJob("0 5 0 * * *", () => {
  //여러 잡이 동시에 돌때 트래픽이 너무 몰리지 않도록 하기 위해 0시 5분에 돌도록 함
  const fs = require("fs")
  for (let i = 0; i < log_list.length; i++) {
    fs.writeFile(`../log/${log_list[i]}`, "", (err) => {
      console.log("cannot find file or ")
    })
  }
}).start()
