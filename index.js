const fs = require("fs");
const readline = require("readline");
const path = require("path");
const rimraf = require("rimraf");
const http2 = require("http2");

class CommandServer {
  constructor() {
    this.commands = {};
  }

  register(cmd, handler) {
    this.commands[cmd] = handler;
  }

  start() {
    const server = http2.createServer();

    server.on("error", error => {
      console.error(error);
    });

    server.on("stream", async (stream, headers) => {
      try {
        const { method, args } = JSON.parse(headers.payload);
        console.log({ method, args });
        const result = await this.commands[method](...args);
        stream.respond({
          "content-type": "application/json",
          ":status": 200
        });
        stream.end(JSON.stringify(result));
      } catch (error) {
        stream.respond({
          "content-type": "application/json",
          ":status": 500
        });
        stream.end(JSON.stringify(false));
      }
    });

    server.listen(8080);
  }
}

const throwBool = fn => {
  try {
    fn();
    return true;
  } catch (error) {
    console.log("error", error);
    return false;
  }
};

const PATHS = {
  get cwd() {
    return process.cwd();
  }
};

class REPL {
  constructor({ url }) {
    this.url = url;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  parseCommand(str) {
    const [method, ...args] = str.trim().split(/\s+/);
    return { method, args };
  }

  userInput(prompt = `${PATHS.cwd}> `) {
    return new Promise(resolve => {
      this.rl.question(prompt, answer => {
        resolve(answer);
      });
    });
  }

  request(method, ...args) {
    const client = http2.connect(this.url);
    return new Promise(resolve => {
      let data = "";
      const request = client.request({
        ":path": "/",
        payload: JSON.stringify({
          method,
          args
        })
      });
      request.on("data", chunk => {
        data += chunk;
      });
      request.on("end", () => {
        client.close();
        resolve(data);
      });
    });
  }

  async run() {
    const input = await this.userInput();
    const { method, args } = this.parseCommand(input);
    try {
      const result = await this.request(method, ...args);
      console.log(result);
    } catch (erro) {
      console.log(`Failed to run ${method}`);
    }
    setTimeout(this.run.bind(this), 0);
  }
}

const connect = () => {
  const repl = new REPL({
    url: "http://localhost:8080"
  });
  repl.run();
};

connect();

const s = new CommandServer();

s.register("ls", async (pth = ".") => {
  return fs.readdirSync(path.resolve(PATHS.cwd, pth));
});

s.register("commands", async () => {
  return Object.keys(s.commands);
});

s.register("mkdir", async dir => {
  fs.mkdirSync(path.resolve(PATHS.cwd, dir));
  return true;
});

s.register("rm", async relativePath => {
  return throwBool(() => {
    rimraf.sync(path.resolve(PATHS.cwd, relativePath));
  });
});

s.register("touch", async (...files) => {
  try {
    for (const file of files) {
      fs.writeFileSync(path.resolve(PATHS.cwd, file));
    }
  } catch (error) {
    return false;
  }
  return true;
});

s.register("cd", async pth => {
  console.log({ pth });
  return throwBool(() => process.chdir(path.resolve(PATHS.cwd, pth)));
});

s.register("add", async (...nums) => {
  return nums.reduce((total, n) => total + parseFloat(n), 0);
})

s.register("pipe", async () => {});

s.register("alias", async (alias, command) => {
  s.register(alias, s.commands[command]);
  return true;
});

s.start();
