const express = require("express");
// bodyParser 解析请求体
const bodyParser = require("body-parser");

// 处理 multipart/form-data 类型的表单数据 主要用于上传文件
const multer = require("multer");
const path = require("path");
const fs = require("node:fs");
const fse = require("fs-extra");
// 定义存放的文件夹地址 这里表示当前文件夹下单uploadFiles
const UPLOADPATH = "uploadFiles"
const upload = multer({ dest: `./${UPLOADPATH}/` });
const app = express();

// 处理跨域请求 的中间件
app.all("*", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});
// 处理URL编码格式的数据
app.use(bodyParser.urlencoded({ extended: false }));
// // 处理JSON格式的数据
app.use(bodyParser.json());

app.use(express.static("static")); //静态资源托管

// upload.single("file") 表明只处理给定的表单字段 这个是file字段
app.post("/upload", upload.single("file"), (req, res) => {
  const { fileHash, chunkIndex } = req.body;
  // 路径为 uploadFiles 下面的 hash
  let tempFileDir = path.resolve(UPLOADPATH, fileHash);
  // 如果当前临时文件夹不存在 则创建对应hash的文件夹
  if (!fs.existsSync(tempFileDir)) {
    fs.mkdirSync(tempFileDir);
  }
  // 最终切片位置存放在 uploadFiles 下面的hash 下面的 chunkIndex
  const targetFilePath = path.resolve(tempFileDir, chunkIndex);
  // multer默认存放的位置
  const currentFilePath = path.resolve(req.file.path);
  if (!fs.existsSync(targetFilePath)) {
    // 如果当前不存在该临时文件夹 则将当前文件切片移动到 目标位置
    fse.moveSync(currentFilePath, targetFilePath);
  } else {
    // 存在 则说明不需要用到上传的切片
    // 所以可以直接删除当前的文件切片
    fse.removeSync(currentFilePath);
  }
  res.send({
    msg: "上传成功",
    code: 200,
  });
});

// 获取完所有切片之后 调取/merge接口 将切片组合成 hash+extname后缀名 的文件
app.get("/merge", async (req, res) => {
  console.log("merge");
  const { fileHash, fileName } = req.query;
  // 最终合并的文件路径
  const targetFilePath = path.resolve(
    UPLOADPATH,
    fileHash + path.extname(fileName)
  );
  // 临时文件夹路径
  const tempFilePath = path.resolve(UPLOADPATH, fileHash);

  const chunkPaths = fse.readdirSync(tempFilePath);

  // 将切片追加到文件中
  let mergeTasks = [];
  for (let i = 0; i < chunkPaths.length; i++) {
    mergeTasks.push(
      new Promise((resolve) => {
        // 当前切片路径
        const chunkPath = path.resolve(tempFilePath, i + "");
        // 将当前遍历的切片追加到文件中
        fse.appendFileSync(targetFilePath, fse.readFileSync(chunkPath));
        // 删除当前遍历的切片
        fse.unlinkSync(chunkPath);
        resolve();
      })
    );
  }
  await Promise.all(mergeTasks);
  // 所有切片放置到新文件之后 删除临时的文件夹
  fse.removeSync(tempFilePath);
  res.send({
    msg: "合并成功",
    code: 200,
  });
});

// 校验是否已经上传过相同的文件  通过hash+extname检测
// 可用于大文件秒传
app.get("/verify", (req, res) => {
  let { fileName, fileHash } = req.query;
  const targetFilePath = path.resolve(UPLOADPATH,fileHash + path.extname(fileName))
  const fileExist = fse.existsSync(targetFilePath)
  res.send({
    code: 200,
    fileExist
  })
});

// 验证完整性 用于断点续传 传递已经上传的切片index
app.get("/verifyIntegrity", (req,res) => {
  let {fileHash} = req.query
  let tempFileDir = path.resolve(UPLOADPATH,fileHash)
  const tempFileDirIsExist = fse.existsSync(tempFileDir)
  const chunkPaths = tempFileDirIsExist ? fse.readdirSync(tempFileDir) : null
  res.send({
    code: 200,
    index: chunkPaths 
  })
})
app.listen(3000, () => {
  console.log("服务已运行:localhost:3000");
});
