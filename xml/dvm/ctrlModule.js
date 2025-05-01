"use strict";
/**
 * 소켓 xml 통신 작업 내용
 * 1. ctrl 이 null 이 아닌 데이터를 받기
 * 2. 해당 ctrl의 속성을 파악하여 올바른 xml 제작하기
 *
 * 3. 해당 xml을 소켓으로
 */
const Database = require("./databaseModule");
const { GMStructor } = require("./GMStructure");
const { RealTimeStructor } = require("./RealtimeStucture");

function makeStringSetXml(objectName, changedCtrl, indoor) {
  return `<?xml version='1.0' encoding='UTF-8'?><root><header sa='mfc' da='dms' messageType='request' dateTime='2011 01 11T12:20:00' dvmControlMode='individual'/><setControl><simple ${objectName}='${changedCtrl}' /><remocon enable='true'/><indoorList><indoor addr='${indoor}' /></indoorList></setControl></root>`;
}

module.exports = {
  setCtrlValue: async function (callback) {
    const rows = await Database.selectNotNull("xml");

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rts = new RealTimeStructor(row);

      // ctrl_value를 매칭해서 <simple> 태그를 생성
      const ctrlValue = rts.ctrlValue;
      const objectName = rts.getObject();

      const gms = new GMStructor({});
      let xml;
      // ctrl value 를 string 형태로 변경해야함
      if (gms[objectName].type === String) {
        const keys = Object.keys(gms[objectName].change);

        for (let ci = 0; ci < keys.length; ci++) {
          let key = keys[ci];
          if (gms[objectName].change[key] === ctrlValue) {
            xml = makeStringSetXml(objectName, key, rts.getIndoor());
            break;
          }
        }
      } else {
        // Number인경우 xml로 바로 변환
        xml = makeStringSetXml(objectName, ctrlValue, rts.getIndoor());
      }
      callback(xml);
      // 데이터를 보내고 난뒤 ctrl value를 비워준다
      Database.updateCtrlValueToNull(rts.getId());
    }
  },
};
