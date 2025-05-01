const ExcelJS = require("exceljs")
let mysql = require("mysql")
const { RejectReason } = require("node-bacnet/lib/enum")
let pgsql = require("pg")
const { connect } = require("pm2")
const { XMLParser } = require('fast-xml-parser');
const { server } = require("jsmodbus")

const filePath = "./uploads/Database.xlsx"

let DATABASE = {}
let MATCHING = {}
let CONNECTION = {}
let ERROR = {}

async function connectMysql(config, dbId) {
  return new Promise((resolve, reject) => {

    let connection = mysql.createConnection(config)

    // connect 는 한번만 실행된다.
    connection.connect(function (err) {
      if (err) {
        console.error("CONNECT!!! connection fail!! / host :", config.host, config.port, dbId)
        resolve(connection)
      } else {
        resolve(connection)
      }
    })

    connection.on('error', (err) => {
      console.error("ERROR!!!", config.host, config.port, ' MySQL 연결이 끊어졌습니다.');
      if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.error("PROTOCOL_CONNECTION_LOST");
      }
    });
  })
}
async function connectPostgresql(config) {
  return new Promise((resolve, reject) => {
    let connection = new pgsql.Client(config) //pg의 Clinet객체를 이용하여 초기화
    connection.connect(function (err) {
      if (err) {
        console.error("[-] connection fail!! / host :", config.host, err)
        resolve(connection)
      } else {
        resolve(connection)
      }
    })
    connection.on('error', (err) => {
      console.error('Client-level error occurred:', err);
    });
    connection.on('end', () => {
      console.log('Client disconnected');
    });
    connection.on('notice', (notice) => {
      console.log('Server notice:', notice.message);
    });
  })
}

function set_log_datatype(M_database, S_database, value) {
  let tmp
  switch (S_database.DB_LogType) {
    case "int":
      tmp = parseFloat(value[0][M_database.DB_LogName])
      break
    case "float":
      tmp = parseInt(value[0][M_database.DB_LogName])
      break
    case "char":
      tmp = "'" + value[0][M_database.DB_LogName] + "'"
      break
    default:
      break
  }
  return `SET ${S_database.DB_LogName}=${tmp}`
}
function set_control_datatype(M_database, S_database, value) {
  //데이터가 존재하는 경우
  if (
    S_database.DB_ControlType != undefined &&
    M_database.DB_ControlType != undefined
  ) {
    //둘다 컨트롤 값을 가지는 경우만 반환
    let tmp
    switch (S_database.DB_ControlType) {
      case "int":
        tmp = parseInt(value[0][M_database.DB_ControlName])
        break
      case "float":
        tmp = parseFloat(value[0][M_database.DB_ControlName])
        break
      case "char":
        tmp = "'" + value[0][M_database.DB_ControlName] + "'"
        break
      default:
        break
    }
    return ` ,${S_database.DB_ControlName}=${tmp}`
  } else {
    // 둘중에 하나라도 없으면 굳이 보낼 필요 없다.
    return ``
  }
}
function set_time_datatype(M_database, S_database, value) {
  //데이터가 존재하는 경우
  if (
    S_database.DB_TimeType != undefined &&
    M_database.DB_TimeType != undefined
  ) {
    //둘다 타임값을 가지는 경우만 반환
    //데이터 형식에 맞춰주어야 한다.
    let tmp
    switch (S_database.DB_TimeType) {
      case "datetime":
        tmp = "'" + value[0][M_database.DB_TimeName] + "'"
        break
      default:
        break
    }
    return ` ,${S_database.DB_TimeName}=${tmp}`
  } else {
    // 둘중에 하나라도 없으면 굳이 보낼 필요가 없다.
    return ``
  }
}
function get_log_datatype(M_database, S_database, value) {
  let tmp
  switch (S_database.DB_LogType) {
    case "int":
      tmp = parseFloat(value[0][M_database.DB_LogName])
      break
    case "float":
      tmp = parseInt(value[0][M_database.DB_LogName])
      break
    case "char":
      tmp = "'" + value[0][M_database.DB_LogName] + "'"
      break
    default:
      break
  }
  return tmp
}
function get_time_datatype(M_database, S_database, value) {
  if (
    S_database.DB_TimeName != undefined &&
    M_database.DB_TimeName != undefined
  ) {
    //둘다 타임값을 가지는 경우만 반환
    //데이터 형식에 맞춰주어야 한다.
    let tmp
    switch (S_database.DB_TimeType) {
      case "datetime":
        tmp = "'" + value[0][M_database.DB_TimeName] + "'"
        break
      default:
        break
    }
    //
    return tmp
  } else {
    return ``
  }
}
async function select_insert(row) {
  //table명, object명, 등등을 받아서 query를 날려야함.
  let M_database
  let S_database
  for (let i = 0; i < DATABASE.length; i++) {
    if (DATABASE[i].DB_Id == row.M_DB_Id) {
      M_database = DATABASE[i]
    }
    if (DATABASE[i].DB_Id == row.S_DB_Id) {
      S_database = DATABASE[i]
    }
    if (M_database != undefined && S_database != undefined) {
      console.log("[ ] find M_database and S_database")
      break
    }
  }
  if (M_database == undefined || S_database == undefined) {
    //둘중에 데이터가 하나가 비어있거나 매칭이 안되는경우
    console.log("[-] Database ID is wrong")
    console.log("[.] check table : ", row)
    tmp.details = "M_database 혹은 S_Database의 정보를 불러올 수 없습니다."
    ERROR[row.Id] = row
    return // 계산하지 않고 함수 종료시킨다
  }
  //ObjectName의 형식이 int거나 char일수 있으므로 이에대한 필터링이 필요함
  sqlstring =
    `SELECT * from ${M_database.DB_TableName} ` +
    `where ${M_database.DB_ObjectName}=${M_database.DB_ObjectType == "char"
      ? "'" + row.M_Objectname + "'"
      : row.M_Objectname
    };`
  //
  let value = await (async function () {
    return new Promise((resolve, reject) => {
      CONNECTION[row.M_DB_Id.toString()].query(sqlstring, (err, res) => {
        if (err) {
          console.log(err)
          row.details = "데이터를 SELECT하는데 오류가 있습니다."
          ERROR[row.Id] = row
          resolve()
        } else {
          console.log(res)
          //값이 비어있는 경우 있을 수 있음.
          if (res.length == 0) {
            row.details =
              "SELECT한 데이터가 비어있습니다. 즉, M_Objectname을 확인해보세요."
            ERROR[row.Id] = row
            resolve()
          }
          resolve(res)
        }
      })
    })
  })()
  if (value == undefined) {
    return
  }
  console.log(value)
  sqlstring =
    `INSERT INTO ${S_database.DB_TableName} ` +
    `${set_log_datatype(M_database, S_database, value)}` +
    `${set_control_datatype(M_database, S_database, value)}` +
    `${set_time_datatype(M_database, S_database, value)}` +
    ` WHERE ${S_database.DB_ObjectName}=${S_database.DB_ObjectType == "char"
      ? "'" + row.S_Objectname + "'"
      : row.S_Objectname
    };`
  CONNECTION[row.S_DB_Id.toString()].query(sqlstring, (err, res) => {
    if (err) {
      console.log(err)
      row.details =
        "데이터가 UPDATE하는데 문제가 발생했습니다. 즉, S_Objectname을 확인해보세요."
      ERROR[row.Id] = row
    } else {
    }
  })
}
async function insert_ecosian(row) {
  let M_database
  let S_database
  for (let i = 0; i < DATABASE.length; i++) {
    if (DATABASE[i].DB_Id == row.M_DB_Id) {
      M_database = DATABASE[i]
    }
    if (DATABASE[i].DB_Id == row.S_DB_Id) {
      S_database = DATABASE[i]
    }
    if (M_database != undefined && S_database != undefined) {
      console.log("[ ] find M_database and S_database")
      break
    }
  }
  if (M_database == undefined || S_database == undefined) {
    //둘중에 데이터가 하나가 비어있거나 매칭이 안되는경우
    console.log("[-] Database ID is wrong")
    console.log("[.] check table : ", row)
    tmp.details = "M_database 혹은 S_Database의 정보를 불러올 수 없습니다."
    ERROR[row.Id] = row
    return // 계산하지 않고 함수 종료시킨다
  }
  //ObjectName의 형식이 int거나 char일수 있으므로 이에대한 필터링이 필요함
  sqlstring =
    `SELECT * from ${M_database.DB_TableName} ` +
    `where ${M_database.DB_ObjectName}=${M_database.DB_ObjectType == "char"
      ? "'" + row.M_Objectname + "'"
      : row.M_Objectname
    };`
  let value = await (async function () {
    return new Promise((resolve, reject) => {
      CONNECTION[row.M_DB_Id.toString()].query(sqlstring, (err, res) => {
        if (err) {
          console.log(err)
          row.details = "데이터를 SELECT하는데 오류가 있습니다."
          ERROR[row.Id] = row
          resolve()
        } else {
          console.log(res)
          //값이 비어있는 경우 있을 수 있음.
          if (res.length == 0) {
            row.details =
              "SELECT한 데이터가 비어있습니다. 즉, M_Objectname을 확인해보세요."
            ERROR[row.Id] = row
            resolve()
          }
          resolve(res)
        }
      })
    })
  })()
  if (value == undefined) {
    return
  }
  // ##########################################################################################
  // ##########################################################################################
  // insert into 테이블명(site_cd, prmt_id, act_tm, val, regi_dttm) values(row.M_Site_Cd, M)
  // ##########################################################################################
  // ##########################################################################################
  sqlstring =
    `INSERT INTO ${S_database.DB_TableName}(site_cd, prmt_id, act_tm, val, regi_dttm) ` +
    `values('${row.M_Site_Cd}', ${row.S_Objectname}, NOW() , ${get_log_datatype(
      M_database,
      S_database,
      value
    )}, ${get_time_datatype(M_database, S_database, value)})`
  CONNECTION[row.S_DB_Id.toString()].query(sqlstring, (err, res) => {
    if (err) {
      console.log(err)
      row.details =
        "데이터가 UPDATE하는데 문제가 발생했습니다. 즉, S_Objectname을 확인해보세요."
      ERROR[row.Id] = row
    } else {
    }
  })
}

async function insert_ecosian2(M_database, S_database, row) {
  //ObjectName의 형식이 int거나 char일수 있으므로 이에대한 필터링이 필요함
  sqlstring =
    `SELECT * from ${M_database.DB_TableName} ` +
    `where ${M_database.DB_ObjectName}=${M_database.DB_ObjectType == "char"
      ? "'" + row.M_Objectname + "'"
      : row.M_Objectname
    };`
  let value = await (async function () {
    return new Promise((resolve, reject) => {
      CONNECTION[row.M_DB_Id.toString()].query(sqlstring, (err, res) => {
        if (err) {
          console.log(err)
          row.details = "데이터를 SELECT하는데 오류가 있습니다."
          ERROR[row.Id] = row
          resolve()
        } else {
          //값이 비어있는 경우 있을 수 있음.
          if (res.length == 0) {
            row.details =
              "SELECT한 데이터가 비어있습니다. 즉, M_Objectname을 확인해보세요."
            ERROR[row.Id] = row
            resolve()
          }
          resolve(res)
        }
      })
    })
  })()
  if (value == undefined) {
    return
  }
  // ##########################################################################################
  // ##########################################################################################
  // insert into 테이블명(site_cd, prmt_id, act_tm, val, regi_dttm) values(row.M_Site_Cd, M)
  // ##########################################################################################
  // ##########################################################################################
  sqlstring =
    `INSERT INTO ${S_database.DB_TableName}(site_cd, prmt_id, act_tm, val, regi_dttm) ` +
    `values('${row.M_Site_Cd}', ${row.S_Objectname}, NOW() , ${get_log_datatype(
      M_database,
      S_database,
      value
    )}, ${get_time_datatype(M_database, S_database, value)})`
  console.log("test:", sqlstring)
  CONNECTION[row.S_DB_Id.toString()].query(sqlstring, (err, res) => {
    if (err) {
      console.log(err)
      row.details =
        "데이터가 UPDATE하는데 문제가 발생했습니다. 즉, S_Objectname을 확인해보세요."
      ERROR[row.Id] = row
    } else {
    }
  })
}

async function select_update(row) {
  //table명, object명, 등등을 받아서 query를 날려야함.
  let M_database
  let S_database
  for (let i = 0; i < DATABASE.length; i++) {
    if (DATABASE[i].DB_Id == row.M_DB_Id) {
      M_database = DATABASE[i]
    }
    if (DATABASE[i].DB_Id == row.S_DB_Id) {
      S_database = DATABASE[i]
    }
    if (M_database != undefined && S_database != undefined) {
      console.log("[ ] find M_database and S_database")
      break
    }
  }
  if (M_database == undefined || S_database == undefined) {
    //둘중에 데이터가 하나가 비어있거나 매칭이 안되는경우
    console.log("[-] Database ID is wrong")
    console.log("[.] check table : ", row)
    tmp.details = "M_database 혹은 S_Database의 정보를 불러올 수 없습니다."
    ERROR[row.Id] = row
    return // 계산하지 않고 함수 종료시킨다
  }
  console.log(row)
  //ObjectName의 형식이 int거나 char일수 있으므로 이에대한 필터링이 필요함
  sqlstring =
    `SELECT * from ${M_database.DB_TableName} ` +
    `where ${M_database.DB_ObjectName}=${M_database.DB_ObjectType == "char"
      ? "'" + row.M_Objectname + "'"
      : row.M_Objectname
    };`
  //
  let value = await (async function () {
    return new Promise((resolve, reject) => {
      CONNECTION[row.M_DB_Id.toString()].query(sqlstring, (err, res) => {
        if (err) {
          console.log(err)
          row.details = "데이터를 SELECT하는데 오류가 있습니다."
          ERROR[row.Id] = row
          resolve()
        } else {
          console.log(res)
          //값이 비어있는 경우 있을 수 있음.
          if (res.length == 0) {
            row.details =
              "SELECT한 데이터가 비어있습니다. 즉, M_Objectname을 확인해보세요."
            ERROR[row.Id] = row
            resolve()
          }
          resolve(res)
        }
      })
    })
  })()
  if (value == undefined) {
    return
  }
  console.log(value)
  sqlstring =
    `UPDATE ${S_database.DB_TableName} ` +
    `${set_log_datatype(M_database, S_database, value)}` +
    `${set_control_datatype(M_database, S_database, value)}` +
    `${set_time_datatype(M_database, S_database, value)}` +
    ` WHERE ${S_database.DB_ObjectName}=${S_database.DB_ObjectType == "char"
      ? "'" + row.S_Objectname + "'"
      : row.S_Objectname
    };`
  CONNECTION[row.S_DB_Id.toString()].query(sqlstring, (err, res) => {
    if (err) {
      console.log(err)
      row.details =
        "데이터가 UPDATE하는데 문제가 발생했습니다. 즉, S_Objectname을 확인해보세요."
      ERROR[row.Id] = row
    } else {
    }
  })
}
async function select_update2(M_database, S_database, row) {
  //ObjectName의 형식이 int거나 char일수 있으므로 이에대한 필터링이 필요함
  sqlstring =
    `SELECT * from ${M_database.DB_TableName} ` +
    `where ${M_database.DB_ObjectName}=${M_database.DB_ObjectType == "char"
      ? "'" + row.M_Objectname + "'"
      : row.M_Objectname
    };`
  //
  let value = await (async function () {
    return new Promise((resolve, reject) => {
      CONNECTION[row.M_DB_Id.toString()].query(sqlstring, (err, res) => {
        if (err) {
          console.log(err)
          row.details = "데이터를 SELECT하는데 오류가 있습니다."
          ERROR[row.Id] = row
          resolve()
        } else {
          console.log(res)
          //값이 비어있는 경우 있을 수 있음.
          if (res.length == 0) {
            row.details =
              "SELECT한 데이터가 비어있습니다. 즉, M_Objectname을 확인해보세요."
            ERROR[row.Id] = row
            resolve()
          }
          resolve(res)
        }
      })
    })
  })()
  if (value == undefined) {
    return
  }
  console.log(value)
  sqlstring =
    `UPDATE ${S_database.DB_TableName} ` +
    `${set_log_datatype(M_database, S_database, value)}` +
    `${set_control_datatype(M_database, S_database, value)}` +
    `${set_time_datatype(M_database, S_database, value)}` +
    ` WHERE ${S_database.DB_ObjectName}=${S_database.DB_ObjectType == "char"
      ? "'" + row.S_Objectname + "'"
      : row.S_Objectname
    };`
  CONNECTION[row.S_DB_Id.toString()].query(sqlstring, (err, res) => {
    if (err) {
      console.log(err)
      row.details =
        "데이터가 UPDATE하는데 문제가 발생했습니다. 즉, S_Objectname을 확인해보세요."
      ERROR[row.Id] = row
    } else {
    }
  })
}
async function select_update_ecosian(row) {
  //table명, object명, 등등을 받아서 query를 날려야함.
  let M_database
  let S_database
  for (let i = 0; i < DATABASE.length; i++) {
    if (DATABASE[i].DB_Id == row.M_DB_Id) {
      M_database = DATABASE[i]
    }
    if (DATABASE[i].DB_Id == row.S_DB_Id) {
      S_database = DATABASE[i]
    }
    if (M_database != undefined && S_database != undefined) {
      console.log("[+] find M_database and S_database")
      break
    }
  }
  if (M_database == undefined || S_database == undefined) {
    //둘중에 데이터가 하나가 비어있거나 매칭이 안되는경우
    console.log("[-] Database ID is wrong")
    console.log("[.] check table : ", row)
    tmp.details = "M_database 혹은 S_Database의 정보를 불러올 수 없습니다."
    ERROR[row.Id] = row
    return // 계산하지 않고 함수 종료시킨다
  }
  console.log(row)
  //ObjectName의 형식이 int거나 char일수 있으므로 이에대한 필터링이 필요함

  // 에코시안 서버에 연결하여 ctrl 데이터를 가져온다.
  sqlstring =
    `SELECT * from ${M_database.DB_TableName} ` +
    `where site_cd='${row.M_Site_Cd}' and ${M_database.DB_ObjectName}=${M_database.DB_ObjectType == "char"
      ? "'" + row.M_Objectname + "'"
      : row.M_Objectname
    };`
  let value = await (async function () {
    return new Promise((resolve, reject) => {
      CONNECTION[row.M_DB_Id.toString()].query(sqlstring, (err, res) => {
        if (err) {
          console.log(err)
          row.details = "[에코시안 관련] 데이터를 SELECT하는데 오류가 있습니다."
          ERROR[row.Id] = row
          resolve()
        } else {
          resolve(res)
        }
      })
    })
  })()
  if (value == undefined || value.rowCount == 0 || value.rows[0].val == null) {
    return
  } else {
    //데이터를 잘 가져왔다면 해당 열을 값을 val=null, regi_id=0, updt_id=0으로 갱신
    sqlstring =
      `UPDATE ${M_database.DB_TableName} SET ${M_database.DB_LogName}=null, regi_id=0, updt_id=0 ` +
      `where site_cd='${row.M_Site_Cd}' and ${M_database.DB_ObjectName}=${M_database.DB_ObjectType == "char"
        ? "'" + row.M_Objectname + "'"
        : row.M_Objectname
      };`
    CONNECTION[row.M_DB_Id.toString()].query(sqlstring, (err, res) => {
      if (err) {
        console.log(err)
        row.details =
          "[에코시안 관련] 데이터를 ctrl,regi_id,updt_id를 갱신하는데에 실패했습니다.."
        ERROR[row.Id] = row
      } else {
        console.log("[에코시안 관련] 데이터 갱신 완료")
      }
    })
  }
  console.log("VALUE:", S_database.DB_ControlName)
  //ObjectName의 형식이 int거나 char일수 있으므로 이에대한 필터링이 필요함

  //ctrl데이터만 갱신하면 된다.
  sqlstring =
    `UPDATE ${S_database.DB_TableName} SET ${S_database.DB_ControlName}=${value.rows[0].val}` +
    ` WHERE ${S_database.DB_ObjectName}=${S_database.DB_ObjectType == "char"
      ? "'" + row.S_Objectname + "'"
      : row.S_Objectname
    };`
  CONNECTION[row.S_DB_Id.toString()].query(sqlstring, (err, res) => {
    if (err) {
      console.log(err)
      row.details =
        "데이터가 UPDATE하는데 문제가 발생했습니다. 즉, S_Objectname을 확인해보세요."
      ERROR[row.Id] = row
    } else {
      console.log("데이터 갱신이 완료~")
    }
  })
}
async function select_update_ecosian2(M_database, S_database, row) {
  //ObjectName의 형식이 int거나 char일수 있으므로 이에대한 필터링이 필요함
  // 에코시안 서버에 연결하여 ctrl 데이터를 가져온다.
  sqlstring =
    `SELECT * from ${M_database.DB_TableName} ` +
    `where site_cd='${row.M_Site_Cd}' and ${M_database.DB_ObjectName}=${M_database.DB_ObjectType == "char"
      ? "'" + row.M_Objectname + "'"
      : row.M_Objectname
    };`
  let value = await (async function () {
    return new Promise((resolve, reject) => {
      CONNECTION[row.M_DB_Id.toString()].query(sqlstring, (err, res) => {
        if (err) {
          console.log(err)
          row.details = "[에코시안 관련] 데이터를 SELECT하는데 오류가 있습니다."
          ERROR[row.Id] = row
          resolve()
        } else {
          resolve(res)
        }
      })
    })
  })()
  if (value == undefined || value.rowCount == 0 || value.rows[0].val == null) {
    return
  } else {
    //데이터를 잘 가져왔다면 해당 열을 값을 val=null, regi_id=0, updt_id=0으로 갱신
    sqlstring =
      `UPDATE ${M_database.DB_TableName} SET ${M_database.DB_LogName}=null, regi_id=0, updt_id=0 ` +
      `where site_cd='${row.M_Site_Cd}' and ${M_database.DB_ObjectName}=${M_database.DB_ObjectType == "char"
        ? "'" + row.M_Objectname + "'"
        : row.M_Objectname
      };`
    CONNECTION[row.M_DB_Id.toString()].query(sqlstring, (err, res) => {
      if (err) {
        console.log(err)
        row.details =
          "[에코시안 관련] 데이터를 ctrl,regi_id,updt_id를 갱신하는데에 실패했습니다.."
        ERROR[row.Id] = row
      } else {
        console.log("[에코시안 관련] 데이터 갱신 완료")
      }
    })
  }
  console.log("VALUE:", S_database.DB_ControlName)
  //ObjectName의 형식이 int거나 char일수 있으므로 이에대한 필터링이 필요함

  //ctrl데이터만 갱신하면 된다.
  sqlstring =
    `UPDATE ${S_database.DB_TableName} SET ${S_database.DB_ControlName}=${value.rows[0].val}` +
    ` WHERE ${S_database.DB_ObjectName}=${S_database.DB_ObjectType == "char"
      ? "'" + row.S_Objectname + "'"
      : row.S_Objectname
    };`

  CONNECTION[row.S_DB_Id.toString()].query(sqlstring, (err, res) => {
    if (err) {
      console.log(err)
      row.details =
        "데이터가 UPDATE하는데 문제가 발생했습니다. 즉, S_Objectname을 확인해보세요."
      ERROR[row.Id] = row
    } else {
      console.log("데이터 갱신이 완료~")
    }
  })
}
async function select_update_obix(M_database, S_database, row) {
  //ObjectName의 형식이 int거나 char일수 있으므로 이에대한 필터링이 필요함
  // 에코시안 서버에 연결하여 ctrl 데이터를 가져온다.
  sqlstring =
    `SELECT * from ${M_database.DB_TableName} ` +
    `where ${M_database.DB_ObjectName}=${M_database.DB_ObjectType == "char"
      ? "'" + row.M_Objectname + "'"
      : row.M_Objectname
    } order by ttime desc limit 1;`
  let value = await (async function () {
    return new Promise((resolve, reject) => {
      CONNECTION[row.M_DB_Id.toString()].query(sqlstring, (err, res) => {
        if (err) {
          console.log(err)
          row.details = "[에코시안 관련] 데이터를 SELECT하는데 오류가 있습니다."
          ERROR[row.Id] = row
          resolve()
        } else {
          resolve(res)
        }
      })
    })
  })()
  if (value == undefined || value.rowCount == 0) {
    return
  } else {
    // 해당 값을 들고와서 그대로 slaveDB에 필요한 name값을 넣어준다.

    const options = {
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: true
    };
    const xmlDataStr = value.rows[0].obix;
    const parser = new XMLParser(options);
    const output = parser.parse(xmlDataStr);
    let _item = null;

    Object.keys(output.obj).forEach(keys => {
      if (Array.isArray(output.obj[keys])) {
        output.obj[keys].forEach(item => {
          if (item["@_name"] == row.name) {
            try {
              _item = item
              _item['type'] = keys
              if (keys == "bool" && _item["@_val"] == true) _item["@_val"] = 1.0
            }
            catch (e) {
              console.log(e)
            }
            return
          }
        });
      }
      else {
        if (output.obj[keys]["@_name"] == row.name) {
          try {
            _item = output.obj[keys]
            _item['type'] = keys
            if (keys == "bool" && _item["@_val"] == true) _item["@_val"] = 1.0
          }
          catch (e) {
            console.log(e)
          }
          return
        }
      }
    });
    if (_item == null) {
      return
    }
    // UPSERT로 데이터를 SlaveDB에 logvalue를 넣어준다.
    sqlstring = `insert into ${S_database.DB_TableName} (id, ${S_database.DB_ObjectName},  ${S_database.DB_LogName}, log_time, object_type, network_type) 
    values(2, '${row.M_Objectname}:${row.name}', ${_item['@_val']}, now(), '${_item['type'] == "bool" ? "BI" : "AI"}', 'modbus') as t 
    on duplicate key update log_value = t.log_value, log_time = t.log_time`

    CONNECTION[row.S_DB_Id.toString()].query(sqlstring, (err, res) => {
      if (err) {
        console.log(err)
        row.details =
          "데이터가 UPDATE하는데 문제가 발생했습니다. 즉, S_Objectname을 확인해보세요."
        ERROR[row.Id] = row
      } else {
        console.log("데이터 갱신이 완료~")
      }
    })
  }
}

function getMatchingDataFromExcel() {
  return new Promise(async (resolve, reject) => {
    //엑셀에 접근하여 한 행마다 비동기로 데이터를 주고 받게 만들어준다.
    console.log("[+] Start Sending Data : start")
    const workbook = new ExcelJS.Workbook() // 엑셀의 객체
    await workbook.xlsx.readFile(filePath)
    const sheetData = []

    const worksheet = workbook.worksheets[1] //page 설정 -> Matching을 선택
    const options = { includeEmpty: true }
    // await worksheet.eachRow(options, (row, rowNum) => {
    //   sheetData[rowNum] = []

    //   row.eachCell(options, (cell, cellNum) => {
    //     sheetData[rowNum][cellNum] = { value: cell.value, style: cell.style }
    //     console.log({ value: cell.value, style: cell.style })

    //   })
    // })
    let key = []
    let flag = 0
    await worksheet.eachRow(options, (row, rowNum) => {
      if (flag != 0) {
        return
      }
      if (rowNum == 1) {
        // key 값을 가져온다.
        row.eachCell(options, (cell, cellNum) => {
          // 키 값의 열을 순회
          key.push(cell.value)
        })
      } else {
        tmp = {}
        row.eachCell(options, (cell, cellNum) => {
          tmp[key[cellNum - 1]] = cell.value
        })
        if (tmp.Id.toString().trim() == "*") {
          flag = 1
          return
        }
        if (MATCHING[[tmp.M_DB_Id, tmp.S_DB_Id]] == undefined) {
          MATCHING[[tmp.M_DB_Id, tmp.S_DB_Id]] = []
        }
        MATCHING[[tmp.M_DB_Id, tmp.S_DB_Id]].push(tmp)
      }
    })
    resolve(true)
  })
}
function endDatabase(DATABASE) {
  return new Promise(async (resolve, reject) => {
    await CONNECTION[DATABASE.DB_Id].end()
    resolve()
  })
}
function connectDatabase(database) {
  return new Promise(async (resolve, reject) => {
    let connection;
    switch (database.DB_Type) {
      case 0: //MS-SQL
        config = {
          user: database.DB_Userid,
          password: database.DB_Userpwd.toStrnig(),
          database: database.DB_Name,
          server: database.DB_Ip,
        }
        break
      case 1: //My-SQL
        config = {
          host: database.DB_Ip,
          port: database.DB_Port,
          user: database.DB_Userid,
          password: database.DB_Userpwd.toString(),
          database: database.DB_Name,
          connectTimeout: 5000,
          dateStrings: "date",
        }
        connection = await connectMysql(config, database.DB_Id)
        CONNECTION[database.DB_Id] = connection
        break
      case 2: //Maria mysql 과 동일함
        config = {
          host: database.DB_Ip,
          port: database.DB_Port,
          user: database.DB_Userid,
          password: database.DB_Userpwd,
          database: database.DB_Name,
          connectTimeout: 5000,
          dateStrings: "date",
        }
        connection = await connectMysql(config, database.DB_Id)
        CONNECTION[database.DB_Id] = connection
        break
      case 3: //PostgreSQL
        //여기서 postgre접근한뒤 config 설정해준다.
        config = {
          host: database.DB_Ip,
          port: database.DB_Port,
          user: database.DB_Userid,
          password: database.DB_Userpwd,
          database: database.DB_Name,
          dateStrings: "date", //이거 되는지 아직 모름
        }
        connection = await connectPostgresql(config) //연결이 되면 connection을 반환한다.바로 접근가능해짐
        CONNECTION[database.DB_Id] = connection
        break
      case 4: //Acces
        console.log("This database is Acces")
        //.mdb에 접근해서 무언가 해야함.
        break
      default:
        console.log("[-] This is Wrong DataType, DB_Id is :", database[i].DB_Id)
        break
    }
    resolve()
  })
}
async function getDatabaseDataFromExcel() {
  return new Promise(async (resolve, reject) => {
    //비동기로 엑셀에서 데이터를 긁어온다.
    console.log("[+] Get Excel Data : start")
    const workbook = new ExcelJS.Workbook() // 엑셀의 객체
    await workbook.xlsx.readFile(filePath)
    const worksheet = workbook.worksheets[0]
    const options = { includeEmpty: true }

    let key = []
    let flag = 0
    await worksheet.eachRow(options, (row, rowNum) => {
      if (flag != 0) {
        return
      }
      if (rowNum == 1) {
        // key 값을 가져온다.
        row.eachCell(options, (cell, cellNum) => {
          // 키 값의 열을 순회
          key.push(cell.value)
        })
      } else {
        tmp = {}
        row.eachCell(options, (cell, cellNum) => {
          tmp[key[cellNum - 1]] = cell.value
        })
        if (tmp.DB_Id.toString().trim() == "*") {
          flag = 1
          return
        }
        DATABASE[tmp.DB_Id] = tmp
      }
    })
    resolve(true)
  })
}
async function connectAllDatabase() {
  return new Promise(async (resolve, reject) => {
    for (const dbId in DATABASE) {
      const database = DATABASE[dbId];
      await connectDatabase(database)
    }
    resolve()
  })
}
async function sendByMatching() {
  return new Promise(async (resolve, reject) => {
    // 통신 별로 루프를 돌린다.
    for (const match in MATCHING) {
      // 통신 연결
      const [masterDbId, serverDbId] = match.split(",")
      console.log("start_sending:", DATABASE[masterDbId])

      if (CONNECTION[masterDbId] && CONNECTION[masterDbId].state === 'disconnected') {
        continue
      }
      if (CONNECTION[serverDbId] && CONNECTION[serverDbId].state === 'disconnected') {
        continue
      }

      // 데이터 통신
      dataProc = MATCHING[match]
      // console.log(dataProc)
      dataProc.forEach((element) => {
        switch (element.Action) {
          case "insert":
            //select_insert(tmp);
            break
          case "insert_ecosian":
            insert_ecosian2(DATABASE[masterDbId], DATABASE[serverDbId], element)
            break
          case "update":
            select_update2(DATABASE[masterDbId], DATABASE[serverDbId], element)
            break
          case "update_ecosian":
            select_update_ecosian2(DATABASE[masterDbId], DATABASE[serverDbId], element)
            break
          case "update_ecosian_obix":
            select_update_obix(DATABASE[masterDbId], DATABASE[serverDbId], element)
            break
          default:
            break
        }
      })
    }
    resolve()
  })
}

async function main() {
  await getDatabaseDataFromExcel() //DB의 정보를 받는다.
  await getMatchingDataFromExcel()
  await connectAllDatabase()

  // TODO : Matching 과 Database 사이에 정합성 문제가 없는지 확인해봐야한다.

  let count = 0
  while (true) {
    await sendByMatching()
    await sleep(60000)
    count += 1

    if (count == 10000) {
      count = 0
    }
  }
}
main()

async function reConnectDatabse() {
  for (const dbId in DATABASE) {
    const database = DATABASE[dbId];
    if (database.DB_Type === 1) {
      if (CONNECTION[dbId] && ["connected", "authenticated"].includes(CONNECTION[dbId].state) === false) {
        console.error(database.Details, "이 연결되어 있지 않아 재연결 시도합니다.");
        await connectDatabase(database)
      }
    }
    else if (database.DB_Type === 3) {
      CONNECTION[dbId].query('SELECT 1', async (err, result) => {
        if (err) {
          console.error(database.Details, "이 연결되어 있지 않아 재연결 시도합니다.");
          await connectDatabase(database);
        }
      });
    }
  }
}
setInterval(reConnectDatabse, 1000 * 60 * 10); // 10분 간격으로 데이터베이스 연결이 되었는지 확인한다.


const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

process.on("SIGINT", function () {
  // console.log("[+] Caught ninterrupt sigal")
  // console.log("[+] Error list:", ERROR)
  process.exit()
})
