
const log_list = ['bacnet-err.log', 'batch-err.log', 'database-err.log', 'modbus-err.log']

const fs = require('fs');
for (let i = 0; i < log_list.length; i++) {
    fs.writeFile(`../log/${log_list[i]}`, "", (err) => {
        console.log("error / cannot find file / already cleared")
    });
}