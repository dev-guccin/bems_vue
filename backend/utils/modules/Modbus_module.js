"use strict";
const DBH = require("./database.js");
const Modbus = require("jsmodbus");
const SerialPort = require("serialport");
const net = require("net");
let Excel = require("./get_excel.js");
const { type } = require("os");
const { select_not_null } = require("./database.js");

const RTU_CLIENTS = [];
const TCP_CLIENTS = [];

let count = 0;

let NETWORKS;
let SOCKETS = [];
let OPTIONS = [];
let CHANNEL_RANGE = {};

main();
require("events").EventEmitter.prototype._maxListeners = 100;

async function main() {
  await Excel.insertModbusInfoByExcel();
  NETWORKS = await DBH.device_select("modbus_network");
  console.log(NETWORKS);
  //modbus poll시작하기 전에 excel정합성 확인
  for (let key in CHANNEL_RANGE) {
    let h = CHANNEL_RANGE[key].start;
    let t = CHANNEL_RANGE[key].end;
    for (let i = 0; i < Datas[key].length; i++) {
      console.log(Datas[key][i]);
      if (Datas[key][i].m_addr < h || Datas[key][i].m_addr > t) {
        console.log(h, t, Datas[key][i].m_addr);
        console.log("excel error in detail id ", Datas[key][i].id);
      }
    }
  }
  console.log("excel 정합성 확인 완료");
  startModbus();
}


setInterval(() => {
  for (let i = 0; i < SOCKETS.length; i++) {

    // 상대 소켓에 문제가 있는경우 다시 연결시켜 준다.
    if (SOCKETS[i].readyState === "closed") {
      SOCKETS[i].connect(OPTIONS[i]);
    }
  }
}, 1000 * 30) // 30초에 한번씩 소켓기동을 확인한다.

async function startModbus() {
  console.log("start modbus"); //,Networks, Channels, Datas)
  for (let i = 0; i < NETWORKS.length; i++) {
    // 소켓을 설정하고 열어준다.
    if (NETWORKS[i].active == 0) continue;

    if (NETWORKS[i].network_type == "tcp/ip") {
      // 1. Socket 생성
      SOCKETS[i] = new net.Socket(); //socket을 객체로 다루기 위해 설정해준다.
      TCP_CLIENTS[i] = [];
      OPTIONS[i] = {
        host: NETWORKS[i].address,
        port: NETWORKS[i].port,
        autoReconnect: true,
        timeout: NETWORKS[i].wait_time,
      };
      let device_list = [];
      let channels = await DBH.getChannels(NETWORKS[i].id); // device id별 채널 가져온다.
      for (let fi = 0; fi < channels.length; fi++) {
        let slave_id = channels[fi].device_address;
        if (device_list[slave_id] == undefined) {
          device_list[slave_id] = [fi];
        } else {
          device_list[slave_id].push(fi);
        }
      }
      console.log("devicelist :", device_list);

      // 2. TCP 생성
      for (let di = 0; di < device_list.length; di++) {
        if (device_list[di] != undefined) {
          console.log("di:", di);
          TCP_CLIENTS[i][di] = new Modbus.client.TCP(SOCKETS[i], di); // tcp를 열어준다.
        }
      }

      // 3. Socket 연결
      SOCKETS[i].connect(OPTIONS[i]); // 실제로 포트를 열어준다.

      // 4. Socket Event 설정
      SOCKETS[i].on("connect", async function () {
        console.log("connect!!:", OPTIONS[i]);
        //소켓이 연결되는 경우 어떻게 사용할 건지
        for (let di = 0; di < device_list.length; di++) {
          if (device_list[di] != undefined) {
            // console.log('device_list[di]:', device_list[di])

            for (let ci = 0; ci < device_list[di].length; ci++) {
              // console.log(device_list[di][ci])
              let fi = device_list[di][ci];
              let slave_id = channels[fi].device_address;

              //frame의 개수만큼 반복하는 코드
              if (channels[fi].active == 1) {
                let func;
                // active 상태일때만 반복시킴
                switch (channels[fi].function_code) {
                  case 0: //Read Coils
                    func = TCP_CLIENTS[i][slave_id].readCoils(
                      channels[fi].start_address,
                      channels[fi].quantity
                    );
                    break;
                  case 1: //Read Discrete Input
                    func = TCP_CLIENTS[i][slave_id].readDiscreteInputs(
                      channels[fi].start_address,
                      channels[fi].quantity
                    );
                    break;
                  case 3: //Read Holding Registers
                    func = TCP_CLIENTS[i][slave_id].readHoldingRegisters(
                      channels[fi].start_address,
                      channels[fi].quantity
                    );
                    break;
                  case 4: //Read Input Registers
                    func = TCP_CLIENTS[i][slave_id].readInputRegisters(
                      channels[fi].start_address,
                      channels[fi].quantity
                    );
                    break;
                }
                DBH.channel_inc("tx", channels[fi].id);
                try {
                  let res = await func;
                  count += 1;
                  console.log("count:", count);
                  console.log("res:", res.response._body.valuesAsArray);
                  response_process(channels[fi], res);
                  await sleep(NETWORKS[i].period);
                } catch (err) {
                  DBH.channel_inc("err", channels[fi].id);
                  console.error("socket network error");
                  console.error("err:", err);
                  console.error(NETWORKS[i].address);
                  console.error(arguments);
                }
              }
            }
          }
        }
        SOCKETS[i].end();
      }); //on
      SOCKETS[i].on("error", function (err) {
        console.error("errored !!!!!!", NETWORKS[i].address);
        console.error("err:", err);
      });
      SOCKETS[i].on("close", function () {
        console.error("closed!!!");
        DBH.check_max_limit();
      });
    } else if (NETWORKS[i].network_type == "rtu") {
      // 1. Socket 생성 (Serial)
      SOCKETS[i] = new SerialPort(NETWORKS[i].address, {
        baudRate: 9600,
      });
      RTU_CLIENTS[i] = [];

      // 2. Socket Event 설정
      SOCKETS[i].on("open", async function () {
        const channels = await DBH.getChannels(NETWORKS[i].id); // ip의 id에 해당하는 데이터들을 가져온다.
        for (let fi = 0; fi < channels.length; fi++) {
          // socket과 slave_id를 통해 clients를 열어준다.
          // device_id를 뽑아서 확인한다.
          let slave_id = channels[fi].device_address;

          // 3. RTU 통신 생성
          if (RTU_CLIENTS[i][slave_id] == undefined) {
            RTU_CLIENTS[i][slave_id] = new Modbus.client.RTU(
              SOCKETS[i],
              slave_id
            ); // 선언해서 device_id로 rtu 연동한다.
          }
          if (channels[fi].active == 1) {
            // active 상태일때만 반복시킴
            switch (channels[fi].function_code) {
              case 0: //Read Coils
                func = RTU_CLIENTS[i][slave_id].readCoils(
                  channels[fi].start_address,
                  channels[fi].quantity
                );
                break;
              case 1: //Read Discrete Input
                func = RTU_CLIENTS[i][slave_id].readDiscreteInputs(
                  channels[fi].start_address,
                  channels[fi].quantity
                );
                break;
              case 3: //Read Holding Registers
                func = RTU_CLIENTS[i][slave_id].readHoldingRegisters(
                  channels[fi].start_address,
                  channels[fi].quantity
                );
                break;
              case 4: //Read Input Registers
                func = RTU_CLIENTS[i][slave_id].readInputRegisters(
                  channels[fi].start_address,
                  channels[fi].quantity
                );
                break;
            }
          }
          DBH.channel_inc("tx", channels[fi].id);
          try {
            let res = await func;
            console.log(res.response._body.valuesAsArray);
            response_process(channels[fi], res);
          } catch (err) {
            DBH.channel_inc("err", channels[fi].id);
            console.error("socket network error");
            console.error(NETWORKS[i].address);
            console.error(arguments);
          }
        }
      });
      SOCKETS[i].on("error", function (err) {
        console.error("errored !!!!!!", NETWORKS[i].address);
        console.error("err:", err);
      });
      SOCKETS[i].on("close", function () {
        console.error("closed!!!");
        DBH.check_max_limit();
      });
    }
  }
}

async function response_process(targetchannels_fi, resp) {
  DBH.channel_inc("rx", targetchannels_fi.id);
  let se, sensors, targetIdx, resData, res, kloc;
  let resp_buffer = resp.response._body._valuesAsBuffer;
  let modbus_result = Buffer.alloc(Buffer.byteLength(resp_buffer, "utf8"));
  //console.log(modbus_result, Buffer.byteLength(modbus_result, 'utf8'), targetchannels_fi.quantity)
  //이제 여기서 데이터를 정규화 하는 작업 해야함
  sensors = await DBH.get_targetdatas(targetchannels_fi.id); //detail객체
  if (sensors === undefined || sensors.length == 0) return; //Detail이 정의되어 있지 않은 경우 연산없이 넘긴다.
  //console.log("set read:", targetchannels_fi.start_address, targetchannels_fi.quantity)
  for (se = 0; se < sensors.length; se++) {
    if (sensors[se].active == 0) continue;
    try {
      resp_buffer.copy(modbus_result);
      targetIdx = (sensors[se].m_addr - targetchannels_fi.start_address) * 2;
      switch (sensors[se].m_dattype) {
        case 0: //unsigned int 16bit AB
          resData = modbus_result.readUInt16BE(targetIdx);
          break;
        case 1: //signed int 16bit AB
          resData = modbus_result.readInt16BE(targetIdx);
          break;
        case 2: //2 : 32bit signed int - AB CD
          resData = modbus_result.readInt32BE(targetIdx);
          break;
        case 3: //3 : 32bit signed int - CD AB
          res = modbus_result
            .slice(targetIdx, targetIdx + 8)
            .swap32()
            .swap16();
          resData = res.readInt32BE();
          break;
        case 4: // 4 :  32bit signed int - BA DC
          res = modbus_result.slice(targetIdx, targetIdx + 8).swap16();
          resData = res.readInt32BE();
          break;
        case 5: //5 :  32bit signed int - DC BA
          res = modbus_result.slice(targetIdx, targetIdx + 8).swap32();
          resData = res.readInt32BE();
          break;
        case 6: //6 : float  - AB CD
          resData = modbus_result.slice(targetIdx, targetIdx + 8).readFloatBE();
          break;
        case 7: //7 : float - CD AB
          res = modbus_result
            .slice(targetIdx, targetIdx + 8)
            .swap32()
            .swap16();
          resData = res.readFloatBE();
          break;
        case 8: //8 : float - BA DC
          res = modbus_result.slice(targetIdx, targetIdx + 4).swap16();
          resData = res.readFloatBE();
          break;
        case 9: //9 : float - DC BAbackend@0.0.0 /home/fmsys/4msys/backend
          res = modbus_result.slice(targetIdx, targetIdx + 4).swap32();
          resData = res.readFloatBE();
          break;
        case 10: //10 : 64bit double - AB CD EF GH
          resData = modbus_result.readDoubleBE(targetIdx);
          break;
        case 11: //11 : 64bit double - GH EF CD AB
          res = modbus_result
            .slice(targetIdx, targetIdx + 8)
            .swap64()
            .swap16();
          resData = res.readDoubleBE();
          break;
        case 12: //12 : 64bit double - BA DC FE HG
          res = modbus_result.slice(targetIdx, targetIdx + 4).swap16();
          resData = res.readDoubleBE();
          break;
        case 13: //13 : 64bit double - HG FE DC BA
          res = modbus_result.slice(targetIdx, targetIdx + 8).swap64();
          resData = res.readDoubleBE();
          break;
        case 14: //14 : 1bit value
          console.log("m_addr:", sensors[se].m_addr);
          if (
            targetchannels_fi.function_code == 3 ||
            targetchannels_fi.function_code == 4
          ) {
            if (sensors[se].m_bitoffset > 15) break; // bitoffset이 16이상이면 연산이 안되고 ERR
            //아날로그로 읽는 경우
            resData =
              (modbus_result.readUInt16BE(targetIdx) >>
                sensors[se].m_bitoffset) %
              2;
          } else {
            //바이너리로 읽어오는 경우
            targetIdx = targetIdx / 2;
            kloc = targetIdx % 8;
            resData =
              (modbus_result.readUInt8(parseInt(targetIdx / 8)) >> kloc) % 2;
          }
          break;
      }
      // }
    } catch (e) {
      console.log("data transform error : ", e);
      resData = NaN; //받는데이터가 요청한 데이터보다 짧을때 처리(na)
    }
    if (resData != NaN) {
      //console.log("resData:", resData, "(id:", sensors[se].id, ")")
      DBH.realtime_upsert(
        sensors[se].id,
        sensors[se].object_name,
        sensors[se].m_r_scale * resData + sensors[se].m_r_offset,
        sensors[se].object_type
      );
    }
  }
}

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

// output부분
var ctrl_list = new Array();

setInterval(() => ctrl_check_start(), 2000);

async function ctrl_check_start() {
  await get_info();
  modbus_output();
}

function get_info() {
  return new Promise(async function (resolve, reject) {
    ctrl_list = [];
    var rows = await DBH.select_not_null("modbus");
    for (const row of rows) {
      let tmp = {};
      tmp.id = row["id"];
      tmp.network_id = row["network_id"];
      tmp.ctrl_value = row["ctrl_value"];
      tmp.object_name = row["object_name"];
      ctrl_list.push(tmp);
    }
    console.log("get_info완료");
    resolve();
  });
}

function make_buffer(dattype, value) {
  let buf;
  switch (dattype) {
    case 0: //unsigned int 16bit AB
      buf = Buffer.alloc(2);
      buf.writeUInt16BE(value);
      break;
    case 1: //signed int 16bit AB
      buf = Buffer.alloc(2);
      buf.writeInt16BE(value);
      break;
    case 2: //2 : 32bit signed int - AB CD
      buf = Buffer.alloc(4);
      buf.writeInt32BE(value);
      break;
    case 3: //3 : 32bit signed int - CD AB
      buf = Buffer.alloc(4);
      buf.writeInt32BE(value).swap32().swap16();
      break;
    case 4: // 4 :  32bit signed int - BA DC
      buf = Buffer.alloc(4);
      buf.writeInt32BE(value).swap16();
      break;
    case 5: //5 :  32bit signed int - DC BA
      buf = Buffer.alloc(4);
      buf.writeInt32BE(value).swap32();
      break;
    case 6: //6 : float  - AB CD (32bit)
      buf = Buffer.alloc(4);
      buf.writeFloatBE(value);
      break;
    case 7: //7 : float - CD AB
      buf = Buffer.alloc(4);
      buf.writeFloatBE(value).swap32().swap16();
      break;
    case 8: //8 : float - BA DC
      buf = Buffer.alloc(4);
      buf.writeFloatBE(value).swap16();
      break;
    case 9: //9 : float - DC BA
      buf = Buffer.alloc(4);
      buf.writeFloatBE(value).swap32();
      break;
    case 10: //10 : 64bit double - AB CD EF GH
      buf = Buffer.alloc(8);
      buf.writeDoubleBE(vlaue);
      break;
    case 11: //11 : 64bit double - GH EF CD AB
      buf = Buffer.alloc(8);
      buf.writeDoubleBE(value).swap64().swap16();
      break;
    case 12: //12 : 64bit double - BA DC FE HG
      buf = Buffer.alloc(8);
      buf.writeDoubleBE(value).swap16();
      break;
    case 13: //13 : 64bit double - HG FE DC BA
      buf = Buffer.alloc(8);
      buf.writeDoubleBE(value).swap64();
      break;
    case 14: //14 : 1bit value
      //이부분 맞는지 확인 필요
      // buf = Buffer.alloc(2)
      if (value == 0) {
        buf = false;
      } else {
        buf = true;
      }
  }
  return buf;
}
async function modbus_output() {
  console.log("modbus_output 시작");
  // console.log('ctrl_list: ', ctrl_list)
  for (var i = 0; i < ctrl_list.length; i++) {
    // let target = ctrl_list[i]
    let target = Object.assign(
      {},
      ctrl_list[i],
      await DBH.get_object_info(ctrl_list[i].object_name)
    ); //dictionary두개 합치기
    // console.log('target: ',target)
    if (target.network_type == "tcp/ip") {
      const socket = new net.Socket();
      const client = new Modbus.client.TCP(socket, target.device_address); //@KNJ
      const options = {
        host: target.address,
        port: target.port,
      };
      socket.on("connect", function () {
        let value = target.ctrl_value * target.m_w_scale + target.m_w_offset; //multi 이면 list , single이면 그냥 단일 value
        console.log(value);
        let buf = make_buffer(target.m_dattype, value);
        let func;
        //client.slave_id= target.device_address          //@knj
        switch (target.m_w_fc) {
          case 5: //write single coil
            func = client.writeSingleCoil(target.m_w_addr, buf);
            break;
          case 6: //write single/multi register
            //  console.log('===========================Address, Value',target.m_w_addr,value)
            //  console.log('===========================Target',target)
            //  console.log('===========================Device ID',target.device_address)
            func = client.writeSingleRegister(target.m_w_addr, value);
          // case 7://write multi register
          //     func = client.writeMultipleRegisters(target.m_w_addr,buf)
          //     break
          default:
            break;
          // case 8://write multi coil
          //     func = client.writeMultipleCoils(target.m_w_addr,value)
          //     break
        }
        func
          .then(async function (resp) {
            console.log(target);
            target.network_type = "modbus";
            await DBH.recover_realtime(target);
            socket.end();
          })
          .catch(function () {
            console.error("===after target");
            console.error(arguments);
            socket.end();
          });
      });
      socket.on("error", function (error) {
        console.log("socket on error");
        console.log(error);
      });
      socket.connect(options);
    } else if (target.network_type == "rtu") {
      const socket = new Serialport(tartget.address, {
        baudRate: 9600,
      });

      const client = new Modbus.client.RTU(socket, target.device_address);

      socket.on("open", function () {
        value = target.ctrl_value * target.m_w_scale + target.m_w_offset; //multi 이면 list , single이면 그냥 단일 value
        // console.log(value)
        buf = make_buffer(target.m_dattype, value);
        console.log(buf);
        switch (target.func) {
          case 5: //write single coil
            func = client.writeSingleCoil(target.address, buf);
            break;
          case 6: //write single/multi register
            func = client.writeMultipleRegisters(target.address, buf);
            break;
        }
        func
          .then(async function (resp) {
            await DBH.recover_realtime(target.object_name);
            // console.log(resp)
            socket.end();
          })
          .catch(function () {
            console.error("error1!!!");
            console.error(arguments);
            socket.end();
          });
      });
      socket.on("error", console.error);
      socket.connect(OPTIONS);
    }
  }
}

// log  file  day reset
const cronJob = require("cron").CronJob; //knj

const log_list = [
  "bacnet-err.log",
  "batch-err.log",
  "database-err.log",
  "modbus-err.log",
];
new cronJob("0 */1 * * *", () => {
  //여러 잡이 동시에 돌때 트래픽이 너무 몰리지 않도록 하기 위해 0시 5분에 돌도록 함
  const fs = require("fs");
  for (let i = 0; i < log_list.length; i++) {
    fs.writeFile(`./utils/log/${log_list[i]}`, "", (err) => {
      console.log("Err list ", err, "======================");
    });
  }
}).start();
