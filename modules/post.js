const client = require('./client');
const db = require('./database');
const path = require('path');
const fs = require('fs');
const formidable = require('formidable');

function Process(req, res){
    var domain = req.get('host').split(':')[0];
    var urlArr = req.originalUrl.replace(/^(\/)/, '').split('/');
    var protocol = req.protocol;
    var GET = false;
    if(urlArr[0] == 'admin') urlArr.shift();
    if(urlArr[0] == 'admin') urlArr.shift();

    if(req.originalUrl.split('?').length > 1){
        GET = {};
        req.originalUrl.split('?')[1].split('&').forEach((keyVal)=>{
            let splitKey = keyVal.split('=');
            GET[splitKey[0]] = !isNaN(splitKey[1]) ? Number(splitKey[1]) : decodeURI(splitKey[1]);
        });
    }
    var POST = req._body ? req.body : false;
    const action = urlArr[0];

    client.load(domain).then(async (client)=>{
        if (client) {
            
            if (action == 'signin'){
                if(POST.email && POST.pass ){
                    db.query(`SELECT * FROM clients c JOIN client_domains cd ON (cd.client = c.id) WHERE cd.domain = '${domain}' AND c.email = '${POST.email.toLowerCase()}'`).then((result)=>{
                        if(result && !result.error){
                            let user = result[0];
                            if(POST.pass === user.password){
                                user.auth = true;
                                req.session.user = user;
                                res.send(user);
                            }else{
                                res.send(false);
                            }
                        } else {
                            res.send(false);
                        }
                    })
                }
            }
        
            if (action == 'check-signin') {
                if(req.session.user) {
                    res.send(req.session.user);
                } else {
                    res.send(null);
                }
            }

            if (action == 'get-pages'){

                let pages = await db.query(`
                    SELECT dp.* 
                    FROM domain_pages dp 
                    JOIN client_domains cd 
                    ON (cd.id = dp.domain)
                    WHERE cd.domain = '${domain}'
                    AND dp.parent = '${POST.parent}'
                `);
                let parent = await db.getRow(`
                    SELECT dp.* 
                    FROM domain_pages dp 
                    JOIN client_domains cd 
                    ON (cd.id = dp.domain)
                    WHERE cd.domain = '${domain}'
                    AND dp.id = '${POST.parent}'
                `);
                let types = await db.query(`SELECT type, count(*) as count FROM ${global.database.database}.domain_pages group by type`);
                let partials;
                if(!parent) {
                    partials = [];
                    let files = fs.readdirSync(path.join(global.paths.clients, client.id.toString(), 'views/partials'));
                    files.forEach(file => {
                        partials.push(file.split('.').shift());
                    })
                }
                let sortedTypes = {};
                types.forEach((type) => {
                    sortedTypes[type.type] = type.count
                })
                let tmp = {
                    parent,
                    pages,
                    types: sortedTypes,
                    partials
                }
                res.send(tmp);
            }
        
            if (action == 'page') {
                if (POST.do){
                    var Do = POST.do;
                    delete POST.do;
                    
                    if(Do == 'create-page'){
                        db.getRow(`SELECT id FROM client_domains WHERE domain = '${domain}'`).then((result)=>{
                            if(result) {
                                POST.domain = result.id;
                                POST.id = Math.random().toString(36).substr(2, 9);
                                db.insert('domain_pages', POST).then((result)=>{
                                    res.send(result)
                                })
                            } else {
                                res.send('error');
                            }
                        })
                    }
                    if(Do == 'edit-page'){
                        
                    }
                    if(Do == 'delete-page'){
                        deleteFile(path.join(global.paths.clients, client.id.toString(), 'views', POST.file.id + '.hbs')).then(async (result) => {
                            
                            let page = await db.query(`DELETE FROM domain_pages WHERE id = '${POST.file.id}'`);
                            let meta = await db.query(`DELETE FROM page_meta WHERE page = '${POST.file.id}'`);
                            let script = await db.query(`DELETE FROM page_scripts WHERE page = '${POST.file.id}'`);
                            let style = await db.query(`DELETE FROM page_styles WHERE page = '${POST.file.id}'`);
                            let tmp = { ok: true };
                            if(result.error) tmp.error = result.error;
                            console.log({POST, page, meta, script, style});
                            res.send(tmp);
                        })
                    }
                }
            }

            if (action == 'delete-partial') {
                if(POST.file) {
                    deleteFile(path.join(global.paths.clients, client.id.toString(), 'views/partials', POST.file) + '.hbs').then((result) => {
                        if(result.ok) res.send({ok: true});
                        else res.send({error: result.error}); 
                    })
                }
            }

            if (action == 'resouces-load') {
                let filesPath = path.join(global.paths.clients, client.id.toString(), 'resources', POST.path);
                fs.readdir(filesPath, (err, files) => {
                    let tmp = {
                        route: POST.path,
                        files: []
                    }
                    if(err) {
                        res.status(500).send(error);
                    } else {
                        if(files.length){
                            files.forEach((fileName, i) => {
                                let filePath = path.join(filesPath, fileName);
                                let file = {
                                    path: filePath,
                                    name: fileName
                                };
                                if (fs.statSync(filePath).isDirectory()) file.directory = true;
                                if (fs.statSync(filePath).isFile()) file.file = true;

                                tmp.files.push(file);
                                if(i == files.length - 1) res.send(tmp);
                            })
                        } else {
                            res.send(tmp);
                        }
                        
                    }
                })
            }

            if (action == 'upload-file') {
                 
                var form = new formidable.IncomingForm();
                form.parse(req, function(err, fields, files) {
                    let dest = path.join(global.paths.clients, String(client.id), 'resources',fields.dest);
                    Object.keys(files).forEach((key, i) => {
                        let file = files[key];
                        let stream = fs.createWriteStream(path.join(dest, file.name));
                        fs.createReadStream(file.path).pipe(stream);
                        
                    });
                    res.send({ok: true});
                });
            }

            if (action == 'save-code') {
                const clientDir = path.join(global.paths.clients, String(client.id));
                var form = new formidable.IncomingForm();
                form.parse(req, function(err, fields, files) {
                    Object.keys(files).forEach((key) => {
                        if(fields[key + '-path']){
                            let filePath = path.join(clientDir, fields[key + '-path']);
                            let dest = fs.createWriteStream(filePath);
                            fs.createReadStream(files[key].path).pipe(dest);
                        }
                    })
                    res.send({ok: true});
                });
            }
        }
    });
}


function deleteFile(path) {
    return new Promise((res) => {
        fs.unlink(path, (err) => {
            if(err) {
                res({error: err});
            } else {
                res({ok: true});
            }
        })
    });
}

module.exports.process = Process;