const client = require('./client');
const resource = require('./resource');
const router = require('./router');
const scripts = require('./scripts');
const path = require('path');
var hbs = require( 'express-handlebars');
var db = require('./database');

// user_modules
const database = require('../exposed_modules/database');
const userRouter = require('../exposed_modules/router');
const session = require('../exposed_modules/session');


const mime = {
    'js': 'application/javascript',
    'min.js': 'application/javascript',
    'js.map': 'application/octet-stream'
}

// main function of get file
function Process(req, res, app){

    // split the request domain
    var domain = req.get('host').split(':')[0];
    //if( global.devDomains.indexOf(domain) > -1) domain = 'npanel.io';

    // split url into array eg: domain.com/account/settings -> ["account", "settings"] 
    var urlArr = req.originalUrl.split('?')[0].replace(/^\/+|\/+$/g, '').split('/');
    // parse get peramiters
    var GET = false;
    if(req.originalUrl.split('?').length > 1){
        GET = {};
        req.originalUrl.split('?')[1].split('&').forEach((keyVal)=>{
            let splitKey = keyVal.split('=');
            GET[splitKey[0]] = !isNaN(splitKey[1]) ? Number(splitKey[1]) : decodeURI(splitKey[1]);
        });
    }

    // http or https
    var protocol = req.protocol;
    // load clinet details

    console.log({
        urlArr,
        GET,
        domain
    })
    client.load(domain).then((client)=>{
        // if client parse client and url to supply files
        // catch client / db errors
        if(client.error) {
            console.log(client);
            res.send(client.error)
        }


        if(client){
            // clients folder directory use global from here out
            var clientDir = global.paths.clientDir = path.join(global.paths.clients, String(client.id));

            // check if url is trying to load a resource file or a page
            if(resource.isResource(urlArr) && !urlArr[0].match(/^[_]+[a-z]+/gm)){
                // pass resolve / clients directory and url Array and sends back file requested or a 404 if it doesn't exsist
                
                if(urlArr[0] === "admin"){
                    if(urlArr[1] === "admin"){
                        urlArr.shift();
                    }
                    
                    let options = false;
                    let lastUrl = urlArr[urlArr.length - 1];
                    let fileExt = lastUrl.split('.');
                    fileExt.shift();
                    if(Object.keys(mime).indexOf(fileExt.join('.')) > -1){
                        options = {type: mime[fileExt.join('.')]};
                    }
                    if(urlArr[1] == '_resource') {
                        resource.send(res, path.join(global.paths.clients, client.id.toString(), 'resources', urlArr.slice(2).join('/')), options);
                    } else {
                        resource.send(res, path.join(global.paths.root, 'www', urlArr.slice(1).join('/')), options);
                    }
                }else{
                    resource.get(res, clientDir, urlArr);
                }
            }else{ 
                if(urlArr[0] === "admin"){
                    // force admin to load for anything domain.com/ADMIN/any/thing
                    resource.send(res, path.join(global.paths.root, 'www/index.html'));
                    
                }else if (urlArr[0].match(/^[_]+[a-z]+/gm)) {
                    try {
                        require('./' + urlArr[0]).proccess(res, client, urlArr);
                    } catch (e) {
                        res.status(404).send(urlArr[0] + ': Handler not found' + e);
                    }
                } else{
                    // setup handlebars to use clients directory for loading layouts / teemplates / and partials
                    app.set('views', path.join(clientDir, 'views'));
                    app.engine('hbs', hbs({
                        extname: 'hbs',
                        layoutsDir: path.join(clientDir, 'views/layouts'),
                        partialsDir: [path.join(global.paths.root, 'defaults/partials'), path.join(clientDir, 'views/partials')],
                        defaultLayout: 'default'
                    }));
                    app.set('view engine', 'hbs');

                    // router determins what pages to load based on database pages not files
                    router.resolve(client, urlArr).then((route)=>{
                        
                        if(route) {
                            // route object to hold all data that comes from user scripts and should be rendered with template
                            
                            // get path to user script
                            let pageScript = path.join(clientDir, 'page_scripts', route.page.id + '.js');
                            
                            // scripts loads and runs server scripts for user exposed_modules will be modules specifically designed to allow user to interact with server safely
                            // also want to setup a user script to run regardless of what page is loaded like a site wide script

                            let modules = {
                                client,
                                database: new database(db),
                                router: new userRouter(client, router),
                                session: new session(req)
                            }
                            scripts.run(pageScript, {
                                client, 
                                GET,
                                req,
                                urlArr
                            }).then((data)=>{
                                if(data && data.error){
                                    // must send errors to client if they appear otherwise they cannot debug code
                                    res.status(500).send(data.error);
                                }else{
                                    // all done 
                                    route.data = data || {};
                                    route.debug = JSON.stringify(route);
                                    try {
                                        res.render(route.page.id, route);
                                    } catch (e) {
                                        res.status(500).send(e);
                                    }
                                }
                                
                            });
                        } else {
                            
                            res.send('Router Cannot Resolve Path: ' + urlArr);
                        }
                    });
                }
            }
            
        }else{
            // no client setup
            res.redirect(`http://npanel.io/noclient?url=${domain + '/' + urlArr.join('/')}`);
        }
    })
}

module.exports.process = Process;