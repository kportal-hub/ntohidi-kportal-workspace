const fs = require('fs');
const axios = require("axios");
const Octokit = require("@octokit/rest");
const { createCipheriv, randomBytes } = require('crypto');

const inputEncoding = 'utf8';
const outputEncoding = 'hex';

async function encrypt(content, algorithm, key) {
    try {
        key = key.substr(key.length - 32);
        const iv = new Buffer.from(randomBytes(16), 'hex');
        const cipher = createCipheriv(algorithm, key, iv);
        let crypted = cipher.update(content, inputEncoding, outputEncoding);
        crypted += cipher.final(outputEncoding);
        return `${iv.toString('hex')}:${crypted.toString()}`;
    } catch (err) {
        console.log(err.message);
        throw err
    }
}

async function encryptAndPutAuthFile(owner, repo, algorithm, gitToken, requestType) {
    try {
        let encryptedPhrase = await encrypt(requestType, algorithm, gitToken);
        let octokit = new Octokit({
            auth: "token " + gitToken
        });
        await octokit.repos.createOrUpdateFile({
            owner,
            repo,
            path: `${requestType}.req`,
            branch: "master",
            message: "add request file",
            content: Buffer.from(encryptedPhrase).toString('base64'),
            gitToken
        });
        return true
    } catch (err) {
        throw err
    }
}


// async function removeFiles(username, repo, requestType, gitToken) {
async function removeFiles(owner, repo, path, branch, message, gitToken) {
    try {
        let octokit = new Octokit({
            auth: "token " + gitToken
        });
        let sha = (await octokit.repos.getContents({
            owner,
            repo,
            path,
        })).data.sha;
        await octokit.repos.deleteFile({
            owner,
            repo,
            path,
            branch,
            message,
            sha
        });
        return true;
    } catch (err) {
        throw err
    }
}

// actions on push
let addCube = async (username, cube, gitToken, repo) => {
    const algorithm = 'aes256';
    const KIDOCODE = "kportal-hub";

    try {
        // create add-cube request to authorize student access
        await encryptAndPutAuthFile(KIDOCODE, repo.split('/')[1], algorithm, gitToken, "add-cube");

        let addCubeRes = await axios.post("https://cubie.now.sh/api/add-cube", {
            username,
            cube,
            gitToken,
            repo: repo.split('/')[1]
        });
        if (addCubeRes.data.result) {
            let cubeInitRes = (await axios.post("https://cubie.now.sh/api/add-cube-init", {
                username,
                cube,
                gitToken,
                repo: repo.split('/')[1]
            })).data;

            // remove auth file
            await removeFiles(KIDOCODE, repo.split('/')[1], "add-cube.req", "master", "Delete auth req file", gitToken);
            await removeFiles(KIDOCODE, repo.split('/')[1], `cubes/${cube}.cube.json`, "master", `Delete ${cube}.cube.json file`, gitToken);
            return cubeInitRes;
        }

        // remove auth file in any cases
        await removeFiles(KIDOCODE, repo.split('/')[1], "add-cube.req", "master", "Delete auth req file", gitToken);
        await removeFiles(KIDOCODE, repo.split('/')[1], `cubes/${cube}.cube.json`, "master", `Delete ${cube}.cube.json file`, gitToken);
        
        return {
            result: false,
            error: "Couldn't put cube.user.json file and enable GitHub page: " + addCubeRes.data
        }
    } catch (err) {
        try {
            // remove auth file in any cases
            await removeFiles(KIDOCODE, repo.split('/')[1], "add-cube.req", "master", "Delete auth req file", gitToken);
            await removeFiles(KIDOCODE, repo.split('/')[1], `cubes/${cube}.cube.json`, "master", `Delete ${cube}.cube.json file`, gitToken);
        } catch(e) {
            return {
                result: false,
                error: "Couldn't delete auth file: " + e.message
            }
        }
        
        return {
            result: false,
            error: "Couldn't add cube: " + err.message
        }
    }

}

const wsOnPush = async (gitToken, repo) => {
    const cube = JSON.parse(fs.readFileSync(process.env.NODE_CUBE, 'utf8')).commits[0].message.split(".")[0];
    if (!(["modified", "complete"].includes(cube))) {
        const userInfo = JSON.parse(fs.readFileSync(`.cubie/cube.json`, 'utf8')).user;
        return await addCube(userInfo.username, cube, gitToken, repo)
    }
}

wsOnPush(process.argv[2], process.argv[3]).then((res) => {
    console.log(res)
})
