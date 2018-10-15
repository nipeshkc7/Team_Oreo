const express = require ('express');
const bodyParser = require ('body-parser');
const path = require('path');
const multer = require('multer');

/* It's a bad idea to have credentials embedded into the source code,
 * It should be passed in as command parameters or
 * accessed via environment variables. But i guess it's fine.
 */
//copyleaks credentials
var email = 'nipeshkc7@gmail.com';
var apikey = 'AF14A871-CA6B-4FC9-8B78-38835EF0668F';

//For the use of Copyleaks node sdk
var CopyleaksCloud = require('plagiarism-checker');
var clCloud = new CopyleaksCloud();
var config = clCloud.getConfig();

/* Setup router stuff */
const router = express.Router();
router.use(bodyParser.json());

/* Populate locals with passed in modules */
let database;
module.exports = function(app, db) {
    database = db;
	app.use('/documents', router);
};

/* Setup file uploading */
let storage = multer.diskStorage({
	destination: function(req, file, callback) {
			callback(null, './uploads');
	},
	filename: function(req, file, callback) {
	    /* Storing date as unix epoch time for uniqueness */
		callback(null, req.session.username + '-' + Date.now() + ".txt");
	}
});
let upload = multer({ storage: storage }).single('userFile');

/* Define routes */
router.all('/*', (req, res, next) => {
	if (!req.session.username) {
        //res.status(403).end("You are not logged in.");
        res.redirect("/login");
        return;
	}
    res.statusCode = 200;
    next()
});

router.get('/', function (req, res, next) {
    let documents;
    database.getDocuments(req.session.username, function (result) {
        documents = result;
        res.render('UserDocuments', {
            title: "Profile Page",
            subtitle:'Upload and manage documents here.',
            condition: false,
            username: req.session.username,
            fname: req.session.fname,
            lname: req.session.lname,
            isAdmin: (req.session.usertype === "admin"),
            documents: documents,
            // helpers: {
            //     encodeU: function (url) { return encodeURIComponent(url); },
            // }
        });
    });
});

router.post('/', (req, res, next) => {
    upload(req, res, function(err) {
        if (err){
            console.log(err);
            res.status(500).send("File upload failed!");
            return;
        }
        if (!req.file) {
            res.status(500).send("No file selected!");
            return;
        }

        /* Store a database record of the uploaded file */
        let date = new Date;

        clCloud.login(email,apikey,config.E_PRODUCT.Education,function (resp,err){
            //Setting headers
            var _customHeaders = {};
            _customHeaders[config.SANDBOX_MODE_HEADER] = true; // Sandbox mode - Scan without consuming any credits and get back dummy results

            /* Create a process using a file  */
            clCloud.createByFile('./uploads/'+req.file.filename,_customHeaders,function(resp,err){
                if(resp && resp.ProcessId){
                    console.log('API: create-by-file');
                    console.log('Process has been created: '+resp.ProcessId);
                    //updating transaction Id to database
                    database.addDocument(req.session.username, req.file.filename, req.file.originalname, date.toISOString(),resp.ProcessId, function (err) {
                        if(err) {
                            console.log("Database error: " + err);
                            return;
                        }
                        console.log("Uploaded: " + req.file.filename);
                        res.redirect("/documents");
                        res.end("File is uploaded");
                    });
                }
                    if(!isNaN(err))
                        console.log('Error: ' + err);
            });

        });
    });
});

/* Delete a document. */
router.post('/delete/:filename', (req, res, next) => {
    let filename = req.params.filename;
    if (!filename) {
        res.status(304).send("filename is required to delete a document!");
        return;
    }

    /* If user is not admin and are deleting a file not belonging to them */
    if ((req.session.usertype !== "admin") && !filename.includes(req.session.username)) {
        res.status(403).send("Can not delete documents not belonging to you.");
        return;
    }

    database.deleteDocument(filename, function (err) {
        if (err) {
            res.status(500).send("Error deleting document: " + err);
            return;
        }
        res.status(200).send("Deleted: " + filename);
    });
});

/* Returns the contents of a file provided a filename */
router.get('/content/:filename', (req, res, next) => {
    let filename = req.params.filename;
    if (!filename) {
        res.status(304).send("filename is required to get contents.");
        return;
    }

    /* If user is not admin and are accessing a file not belonging to them */
    if ((req.session.usertype !== "admin") && !filename.includes(req.session.username)) {
        res.status(403).send("Can not get documents not belonging to you.");
        return;
    }
    database.getDocumentContent(filename, function (err, data) {
        if (err) {
            res.status(500).send("Error getting document: " + err);
            return;
        }
        res.setHeader('content-type', 'text/plain');
        res.status(200).end(data);
    });
});

/* Saves content to file */
router.put('/content/:filename', (req, res, next) => {
    let filename = req.params.filename;
    let content = req.body["data"];
    if (!filename) {
        res.status(304).send("filename is required to get contents.");
        return;
    }
    database.saveDocumentContent(filename, content, function (err) {
        if (err) {
            res.status(500).send("Error getting document: " + err);
            return;
        }
        res.status(200).end("saved");
    });
});

//shows plagarism results
router.get('/showresults/:transactionId&:filename', (req, res, next) => {
    let transactionId = req.params.transactionId;
    let filename= req.params.filename;
    if (!transactionId) {
        res.status(304).send("transactionId is required to get contents.");
        return;
    }
    database.getDocumentContent(filename, function (err, data) {
        clCloud.login(email,apikey,config.E_PRODUCT.Education,function getStatusCallback(resp,err){
            clCloud.getProcessResults(transactionId,function(statusResp,err){
                if(JSON.stringify(statusResp) != '{}'){
                    clCloud.getComparisonReport(statusResp[0].ComparisonReport,function(comparisonResp,err){
                        clCloud.getResultRawText(statusResp[0].CachedVersion,function(rawTextResp,err){
                            console.log('Results: ' + JSON.stringify(statusResp));
                            res.render('resultspage', {
                                title: 'Plagiarism Results',
                                condition: false,
                                username: req.session.username,
                                fname: req.session.fname,
                                lname: req.session.lname,
                                responseArray: statusResp,
                                comparisonArray: comparisonResp,
                                rawText:rawTextResp,
                                fileName:filename,
                                sourceText:data,
                                mArray:statusResp,
                                identicalWords: comparisonResp.Identical,
                                helpers: {
                                    encodeU: function (url) { return encodeURIComponent(url); },
                                    jsonStringify: function (jsonobj) { return encodeURIComponent(JSON.stringify(jsonobj)); },
                                    getScore: function(jsonobj) { return jsonobj[0].Percents}
                                }
                            });
                            if(!isNaN(err))
                            console.log('Error: ' + err);
                        });
                    })
                }else{
                    console.log("Empty response from server");
                    res.status(200).end("Results not ready.. Check back later");
                }
                if(!isNaN(err))
                console.log('Error: ' + err);
            });   
        });
    });
});

router.get('/showIndividualComparison/:comparisonReport&:cachedVersion&:resultsArray&:sourceText', (req, res, next) => {
    // console.log("Request is defined");
     let comparisonReport=req.params.comparisonReport;
     let cachedVersion=req.params.cachedVersion;
     let statusResp=JSON.parse(req.params.resultsArray);
     let data=req.params.sourceText;
    clCloud.login(email,apikey,config.E_PRODUCT.Education,function getStatusCallback(resp,err){
        clCloud.getResultRawText(cachedVersion,function(rawTextResp,err){
             clCloud.getComparisonReport(comparisonReport,function(comparisonResp,err){
                //render results here 
                console.log("Received the raw text resp"+ JSON.stringify(comparisonResp));
                res.render('resultspage', {
                    title: 'Plagiarism Results',
                    condition: false,
                    username: req.session.username,
                    fname: req.session.fname,
                    lname: req.session.lname,
                    responseArray: statusResp,
                    comparisonArray: comparisonResp,
                    rawText:rawTextResp,
                    sourceText:data,
                    mArray:statusResp,
                    identicalWords: comparisonResp.Identical,
                    helpers: {
                        encodeU: function (url) { return encodeURIComponent(url); },
                        jsonStringify: function (jsonobj) { return encodeURIComponent(JSON.stringify(jsonobj)); },
                        getScore: function(jsonobj) { return jsonobj[0].Percents}
                    }
                });
                //console.log('Result raw text: ' + rawTextresp);
                if(!isNaN(err))
                console.log('Error: ' + err);
            });
        });
    });
});
