"use strict";
const utils = require('@iobroker/adapter-core');
let adapter;
const MikroNode = require('mikronode-ng');
let _poll, poll_time, connect = false, timer, iswlan = false;
let con, _con, connection;
let states = {
    "wireless":   [],
    "dhcp":       [],
    "interface":  [],
    "filter":     [],
    "nat":        [],
    "firewall":   [],
    "lists":      {
        "dhcp_list":     [],
        "wifi_list":     [],
        "firewall_list": []
    },
    "systeminfo": {}
};
let old_states = {
    "wireless":   [],
    "dhcp":       [],
    "interface":  [],
    "filter":     [],
    "nat":        [],
    "firewall":   [],
    "lists":      {
        "dhcp_list":     [],
        "wifi_list":     [],
        "firewall_list": []
    },
    "systeminfo": {}
};

let commands = {
    "reboot":       "/system/reboot",
    "shutdown":     "/system/shutdown",
    "usb_reset":    "/system/routerboard/usb/power-reset",
    "add_firewall": ""
};

function startAdapter(options){
    return adapter = utils.adapter(Object.assign({}, options, {
        systemConfig: true,
        name:         'mikrotik',
        ready:        main,
        unload:       (callback) => {
            clearTimeout(_poll);
            clearTimeout(timer);
            if (connection){
                _con.clearEvents = true;
                connection.close();
            }
            try {
                adapter.log.debug('cleaned everything up...');
                callback();
            } catch (e) {
                callback();
            }
        },
        stateChange:  (id, state) => {
            if (state && !state.ack){
                adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
                let ids = id.split(".");
                let val = state.val;
                let cmd = ids[ids.length - 1].toString().toLowerCase();
                let cmdlist;
                //adapter.log.error('[cmd] = ' + cmd);
                if (commands[cmd] !== undefined){
                    if (cmd === 'add_firewall'){
                        cmdlist = val.split(",");
                        // e.g.  "name,127.0.0.1,comment"
                        SetCommand('/ip/firewall/address-list/add\n=list=' + cmdlist[0] + '\n=address=' + cmdlist[1] + '\n=comment=' + cmdlist[2]);
                    } else {
                        SetCommand(commands[cmd]);
                    }
                }
                if (cmd === 'raw'){
                    cmdlist = val.split(",");
                    SetCommand(cmdlist);
                }
                if (cmd === 'send_sms'){
                    //system resource usb print
                    //port print detail 
                    //tool sms send port=usb1 channel=2 phone-number="+7..." message="text"
                }
                if (cmd === 'disabled'){
                    let _id;
                    id = id.replace('disabled', 'id');
                    adapter.getState(id, (err, st) => {
                        if ((err || !st)){
                            adapter.log.error('getState ' + JSON.stringify(err));
                        } else {
                            _id = st.val.replace('*', '');
                            GetCmd(id, cmd, _id, val);
                        }
                    });
                }
            }
        }
    }));
}

function GetCmd(id, cmd, _id, val){
    let set;
    let ids = id.split(".");
    if (val === true || val === 'true'){
        val = 'yes';
    } else {
        val = 'no';
    }
    if (ids[2] === 'filter'){
        set = '/ip/firewall/filter/set\n=disabled=' + val + '\n=.id=*' + _id;
    }
    if (ids[2] === 'interface'){
        set = '/interface/set\n=disabled=' + val + '\n=.id=*' + _id;
    }
    if (ids[2] === 'nat'){
        set = '/ip/firewall/nat/set\n=disabled=' + val + '\n=.id=*' + _id;
    }
    if (ids[2] === 'firewall'){
        set = '/ip/firewall/address-list/set\n=disabled=' + val + '\n=.id=*' + _id;
    }
    SetCommand(set);
}

function SetCommand(set){
    adapter.log.debug('SetCommand ' + set);
    _con.write(set, (ch) => {
        ch.once('done', (p) => {
            let d = MikroNode.parseItems(p);
            adapter.log.info('SetCommand response: ' + JSON.stringify(d));
            adapter.setState('commands.response', JSON.stringify(d), true);
        });
        ch.on('error', (err, chan) => {
            err(err);
        });
    });
}


function main(){
    adapter.subscribeStates('*');
    poll_time = adapter.config.poll ? adapter.config.poll : 5000;
    con = {
        "host":     adapter.config.host ? adapter.config.host :"192.168.1.11",
        "port":     adapter.config.port ? adapter.config.port :8728,
        "login":    adapter.config.login ? adapter.config.login :"admin",
        "password": adapter.config.password ? adapter.config.password :""
    };
    if (con.host && con.port){
        let _connection = MikroNode.getConnection(con.host, con.login, con.password, {
            port:           con.port,
            timeout:        adapter.config.timeout ? adapter.config.timeout : 10,
            closeOnTimeout: true,
            closeOnDone:    false
        });
        connection = _connection.connect((c) => {
            _con = c.openChannel();
            _con.clearEvents = true;
            adapter.log.info('MikroTik ' + c.status + ' to: ' + c.host);
            adapter.setState('info.connection', true, true);
            connect = true;
            parse();
        });
        connection.on('trap', (e) => {
            adapter.log.debug('TRAP ' + JSON.stringify(e));
            err(e);
        });
        connection.on('timeout', (e) => {
            err(e);
        });
        connection.on('error', (e) => {
            err(e);
        });
        connection.on('close', (e) => {
            err(e);
        });
    }
}

let flag = false;

function ch1(cb){
    //if(adapter.config.ch1){
    _con.write('/system/resource/print', (ch) => {
        //_con.closeOnDone = true;
        _con.once('done', (p) => {
                let d = MikroNode.parseItems(p);
                states.systeminfo = d[0];
                adapter.log.debug('/system/resource/print' + JSON.stringify(d));
                cb && cb();
            });
        if (!flag){
            flag = true;
            ch.on(
                'error', (e) => {
                    adapter.log.debug('Oops: ' + e);
                });
        }
    });
    //} else cb();
}

function ch2(cb){
    if (adapter.config.ch2){
        _con.write('/ip/firewall/nat/print', () => {
            _con.once('done', (p) => {
                let d = MikroNode.parseItems(p);
                ParseNat(d);
                adapter.log.debug('/ip/firewall/nat/print' + JSON.stringify(d));
                cb && cb();
            });
            /*_con.once('error', function(e, chan) {
                err(e, true);
            });*/
        });
    } else cb && cb();
}

function ch3(cb){
    if (adapter.config.ch3){
        _con.write('/ip/dhcp-server/lease/print', () => {
            _con.once('done', (p) => {
                let d = MikroNode.parseItems(p);
                ParseDHCP(d);
                adapter.log.debug('/ip/dhcp-server/lease/print' + JSON.stringify(d));
                cb && cb();
            });

            /*_con.once('error', function(e, chan) {
                err(e, true);
            });*/
        });
    } else cb && cb();
}

function ch4(cb){
    if (adapter.config.ch4){
        _con.write('/interface/print', () => {
            _con.once('done', (p) => {
                let d = MikroNode.parseItems(p);
                ParseInterface(d);
                adapter.log.debug('/interface/print' + JSON.stringify(d));
                cb && cb();
            });
            /*_con.once('error', function(e, chan) {
                err(e, true);
            });*/
        });
    } else cb && cb();
}

function ch5(cb){
    if (adapter.config.ch5){
        _con.write('/ip/firewall/filter/print', () => {
            _con.once('done', (p) => {
                let d = MikroNode.parseItems(p);
                ParseFilter(d);
                adapter.log.debug('/ip/firewall/filter/print' + JSON.stringify(d));
                cb && cb();
            });
            /*_con.once('error', function(e, chan) {
                err(e, true);
            });*/
        });
    } else cb && cb();
}

function ch6(cb){
    if (adapter.config.ch6){
        if (iswlan){
            _con.write('/interface/wireless/registration-table/print', () => {
                _con.once('done', (p) => {
                    let d = MikroNode.parseItems(p);
                    ParseWiFi(d);
                    adapter.log.debug('/interface/wireless/registration-table/print' + JSON.stringify(d));
                    cb && cb();
                });
                /*_con.once('error', function(e, chan) {
                 err(e, true);
                 });*/
            });
        } else {
            adapter.log.debug('Mikrotik is not WiFi');
            cb && cb();
        }
    } else cb && cb();
}

function ch7(cb){
    if (adapter.config.ch7){
        _con.write('/ip/address/print', () => {
            _con.once('done', (p) => {
                let d = MikroNode.parseItems(p);
                ParseWAN(d);
                adapter.log.debug('/ip/address/print' + JSON.stringify(d));
                cb && cb();
            });
            /*_con.once('error', function(e, chan) {
             err(e, true);
             });*/
        });
    } else cb && cb();
}

function ch8(cb){
    if (adapter.config.ch8){
        _con.write('/ip/firewall/address-list/print', () => {
            _con.once('done', (p) => {
                let d = MikroNode.parseItems(p);
                ParseFirewallList(d);
                adapter.log.debug('/ip/firewall/address-list/print' + JSON.stringify(d));
                cb && cb();
            });
            /*_con.once('error', function(e, chan) {
             err(e, true);
             });*/
        });
    } else cb && cb();
}

function parse(){
    clearTimeout(_poll);
    _poll = setTimeout(() => {
        ch1(() => {
            ch2(() => {
                ch3(() => {
                    ch4(() => {
                        ch5(() => {
                            ch6(() => {
                                ch7(() => {
                                    ch8(() => {
                                        SetStates();
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    }, poll_time);
}

function ParseNat(d, cb){
    let res = [];
    d.forEach((item, i) => {
        if (d[i][".id"] !== undefined){
            res.push(
                {
                    "id":            d[i][".id"],
                    "chain":         d[i]["chain"],
                    "comment":       d[i]["comment"],
                    "disabled":      d[i]["disabled"],
                    "out-interface": d[i]["out-interface"],
                    "action":        d[i]["action"]
                });
        }
    });
    states.nat = res;
    //cb();
}

function ParseFilter(d, cb){
    let res = [];
    d.forEach((item, i) => {
        if (d[i]["disabled"] !== undefined){
            res.push({
                "id":       d[i][".id"],
                "chain":    d[i]["chain"],
                "comment":  d[i]["comment"],
                "disabled": d[i]["disabled"]
            });
        }
    });
    states.filter = res;
    //cb();
}

function formatSize(d){
    let i = 0, type = ['б', 'Кб', 'Мб', 'Гб', 'Тб', 'Пб'];
    while ((d / 1000 | 0) && i < type.length - 1) {
        d /= 1024;
        i++;
    }
    return parseInt(d).toFixed(2) + ' ' + type[i];
}

function ParseInterface(d, cb){
    let res = [];
    d.forEach((item, i) => {
        if (d[i]["name"] !== undefined){
            res.push({
                "name":            d[i]["name"],
                "id":              d[i][".id"],
                "type":            d[i]["type"],
                "disabled":        d[i]["disabled"],
                "mac-address":     d[i]["mac-address"],
                "running":         d[i]["running"],
                "total_rx_byte":   d[i]["rx-byte"],
                "total_tx_byte":   d[i]["tx-byte"],
                "rx":              (((parseInt(d[i]["rx-byte"]) - parseInt(old_states.interface[i] ? old_states.interface[i]['total_rx_byte'] :d[i]["rx-byte"])) / (adapter.config.poll / 1000)) * 0.008).toFixed(2),
                "tx":              (((parseInt(d[i]["tx-byte"]) - parseInt(old_states.interface[i] ? old_states.interface[i]['total_tx_byte'] :d[i]["tx-byte"])) / (adapter.config.poll / 1000)) * 0.008).toFixed(2),
                "total_rx_packet": d[i]["rx-packet"],
                "total_tx_packet": d[i]["tx-packet"],
                "rx_packet":       ((parseInt(d[i]["rx-packet"]) - parseInt(old_states.interface[i] ? old_states.interface[i]['total_rx_packet'] :d[i]["rx-packet"])) / (adapter.config.poll / 1000)).toFixed(0),
                "tx_packet":       ((parseInt(d[i]["tx-packet"]) - parseInt(old_states.interface[i] ? old_states.interface[i]['total_tx_packet'] :d[i]["tx-packet"])) / (adapter.config.poll / 1000)).toFixed(0),
            });
        }
        if (d[i]["type"] === 'wlan'){
            iswlan = true;
        }
    });
    states.interface = res;
    //cb();
}

function ParseWiFi(d, cb){
    let res = [];
    let name;
    states.lists.wifi_list = [];
    d.forEach((item, i) => {
        name = '';
        if (d[i]["mac-address"] !== undefined){
            getNameWiFi(d[i]["mac-address"], (n) => {
                name = n;
                res.push({
                    "last-ip":       d[i]["last-ip"],
                    "id":            d[i][".id"],
                    "mac-address":   d[i]["mac-address"],
                    "last-activity": d[i]["last-activity"],
                    "interface":     d[i]["interface"],
                    "name":          name
                });
            });
        }
        states.lists.wifi_list.push({
            "ip":   d[i]["last-ip"],
            "mac":  d[i]["mac-address"],
            "name": name
        });
    });
    states.wireless = res;
    //cb();
}

function ParseDHCP(d, cb){
    let res = [];
    states.lists.dhcp_list = [];
    d.forEach((item, i) => {
        //if (d[i]["host-name"]/* !== undefined*/){
        if (!d[i]["host-name"] && d[i]["mac-address"]){
            if (d[i]["comment"]){
                d[i]["host-name"] = d[i]["comment"];
            } else {
                d[i]["host-name"] = d[i]["mac-address"].replace(/[:]+/g, '');
            }
        }
        res.push(
            {
                "name":        d[i]["host-name"] ? d[i]["host-name"] :d[i]["comment"],
                "id":          d[i][".id"],
                "address":     d[i]["address"],
                "mac-address": d[i]["mac-address"],
                "server":      d[i]["server"],
                "status":      d[i]["status"],
                "comment":     d[i]["comment"] ? d[i]["comment"] :'',
                "blocked":     d[i]["blocked"]
            });
        //}
        if (d[i]["status"] !== 'waiting'){
            states.lists.dhcp_list.push(
                {
                    "ip":   d[i]["address"],
                    "mac":  d[i]["mac-address"],
                    "name": d[i]["host-name"]
                });
        }
    });
    states.dhcp = res;
    //cb();
}

function ParseWAN(d, cb){
    let res = [];
    d.forEach((item, i) => {
        if (d[i][".id"] !== undefined){
            if (d[i]["interface"] === d[i]["actual-interface"]){
                states.systeminfo.wan = d[i]["address"];
            }
        }
    });
    //cb();
}

function ParseFirewallList(d, cb){
    let res = [];
    let name;
    states.lists.firewall_list = [];
    d.forEach((item, i) => {
        name = '';
        if (d[i]["address"] !== undefined){
            res.push({
                "address":  d[i]["address"],
                "id":       d[i][".id"],
                "name":     d[i]["list"] + d[i][".id"].replace('*', '_'),
                "disabled": d[i]["disabled"],
                "comment":  d[i]["comment"]
            });
        }
        states.lists.firewall_list.push({
            "name":    d[i]["list"],
            "address": d[i]["address"]
        });
    });
    states.firewall = res;
    //cb();
}

function SetStates(){
    Object.keys(states).forEach((key) => {
        if (states[key].length !== undefined && key !== 'lists'){
            states[key].forEach((item, i) => {
                Object.keys(states[key][i]).forEach((k) => {
                    if (old_states[key][i] == undefined){
                        old_states[key].push({});
                    }
                    if (states[key][i][k] !== old_states[key][i][k]){
                        old_states[key][i][k] = states[key][i][k];
                        let ids = '';
                        if (states[key][i]['name'] !== undefined){
                            if (states[key][i]['server'] !== undefined){
                                ids = key + '.' + states[key][i]['server'] + '.' + states[key][i]['name'] + '.' + k;
                            } else {
                                ids = key + '.' + states[key][i]['name'] + '.' + k;
                            }
                        } else {
                            ids = key + '.id' + states[key][i]['id'].replace('*', '_') + '.' + k;
                        }
                        setObject(ids, states[key][i][k]);
                    }
                });
            });
        } else {
            if (key === 'lists'){
                Object.keys(states[key]).forEach((k) => {
                    let ids = key + '.' + k;
                    setObject(ids, JSON.stringify(states[key][k]));
                });
            } else if (key === 'systeminfo'){
                Object.keys(states[key]).forEach((k) => {
                    if (states[key][k] !== old_states[key][k]){
                        old_states[key][k] = states[key][k];
                        let ids = key + '.' + k;
                        setObject(ids, states[key][k]);
                    }
                });
            }
        }
    });
    parse();
}

function setObject(name, val){
    let type = 'string';
    let role = 'state';
    adapter.log.debug('setObject ' + JSON.stringify(name));
    adapter.getState(name, (err, state) => {
        if ((err || !state)){
            if (~name.indexOf('disabled') || ~name.indexOf('blocked')){
                type = 'boolean';
            } else {
                role = 'indicator';
            }
            adapter.setObject(name, {
                type:   'state',
                common: {
                    name: name,
                    desc: name,
                    type: type,
                    role: role
                },
                native: {}
            });
            adapter.setState(name, {val: val, ack: true});
        } else {
            adapter.setState(name, {val: val, ack: true});
        }
    });
    //adapter.subscribeStates('*');
}

function getNameWiFi(mac, cb){
    let res = mac;
    let n = 0;
    states.dhcp.forEach((item, i) => {
        if (states.dhcp[i]['mac-address'] === mac){
            res = states.dhcp[i]['name'];
        }
        n++;
        if (n === states.dhcp.length){
            cb(res);
        }
    });
}

function err(e, er){
    if (e){
        e = e.toString();
        if (connect){
            adapter.log.error('Oops: ' + e);
        }
        if (~e.indexOf('cannot log in')){
            adapter.log.error('Error: ' + e + '. Incorrect username or password');
        }
        if (~e.indexOf('ECONNRESET') || ~e.indexOf('closed') || ~e.indexOf('ended') || ~e.indexOf('Timeout') && !er){
            connection.close();
            flag = false;
            clearTimeout(_poll);
            clearTimeout(timer);
            connect = false;
            _poll = null;
            adapter.log.error('Error socket: Reconnect after 15 sec...');
            adapter.setState('info.connection', false, true);
            timer = setTimeout(() => {
                clearTimeout(timer);
                main();
            }, 15000);
        }
    }
}

if (module.parent){
    module.exports = startAdapter;
} else {
    startAdapter();
}
