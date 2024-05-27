const fileEle = document.querySelector("#file");
const uploadButton = document.querySelector("#upload");
const continueButton = document.querySelector("#continue");

let fileHash = "";
let fileName = "";
uploadButton.addEventListener("click", async (e) => {
  e.preventDefault();
  console.log("上传按钮被点击了");
  console.log(fileEle.files[0]); // 获取选择文件的file数据
  const file = fileEle.files[0];
  uploadFile(file);
});

/**
 * 单个文件chunk上传
 * @param {*} file
 * @returns
 */
const uploadHandler = async (chunk) => {
  return new Promise((resolve, reject) => {
    try {
      const fd = new FormData();
      fd.append("file", chunk.file);
      fd.append("fileHash", chunk.fileHash);
      fd.append("chunkIndex", chunk.chunkIndex);
      // let xhr = new XMLHttpRequest()
      // xhr.open("POST","http://localhost:3000/upload")
      // xhr.onload = function(e) {
      //   console.log("e",e)
      //   console.log("xhr",xhr)
      //   let data = JSON.parse(xhr.responseText)
      //   if(xhr.status == 200 && data['code'] == 200) {
      //     chunk.uploaded = true
      //     resolve(data)
      //   }
      // }
      // xhr.send(fd)

      let result = fetch("http://localhost:3000/upload", {
        method: "POST",
        body: fd,
      }).then((res) => res.json());
      chunk.uploaded = true;
      resolve(result);
    } catch (e) {
      reject(e);
    }
  });
};
// 预设10MB切片
const chunkSize = 1024 * 1024 * 10;
/**
 * 文件切片
 * @param {*} file 上传的文件
 * @returns 返回文件切片
 */
const createChunks = (file) => {
  let chunks = [];
  let start = 0;
  let index = 0;

  while (start < file.size) {
    let chunk = file.slice(start, start + chunkSize);
    chunks.push({
      file: chunk,
      uploaded: false,
      chunkIndex: index,
      fileHash: fileHash, // 把hash加上 用于分辨是属于哪个文件的chunk块
    });
    start += chunkSize;
    index++;
  }

  return chunks;
};

/**
 * 通过spark-md5获取文件hash值
 * @param {*} file 文件
 * @returns 返回hash值
 */
const getHash = (file) => {
  console.log("file", file);
  const cutSize = 100;
  const size = file.size;
  const middle = Math.floor(size / 2);
  let sparkmd5 = new SparkMD5()
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    // 截取前中后做hash值
    let cutFiles = [file.slice(0, cutSize),file.slice(middle, middle + 100),file.slice(size - cutSize, size)]
    let i = 0;
    const loadNext = () => {
      fileReader.readAsArrayBuffer(cutFiles[i])
    }
    fileReader.onload = function (e) {
      if (i == 2) {
        const fileMd5 = sparkmd5.end();
        console.log("fileMd5",fileMd5)
        resolve(fileMd5);
      } else {
        i++;
        sparkmd5.append(e.target.result);
        loadNext()
      }
    };
    loadNext()
    // fileReader.readAsArrayBuffer(cutFile); // 通过ArrayBuffer读取
    // fileReader.onload = function (e) {
    //   console.log(e.target.result);
    //   let fileMD5 = SparkMD5.ArrayBuffer.hash(e.target.result);
    //   console.log(fileMD5);
    //   resolve(fileMD5);
    // };
  });
};

/**
 * 批量上传chunk
 * @param {*} chunks
 * @param {*} maxRequest 最大并发数
 * @returns
 */
const uploadChunks = (chunks, maxRequest = 6) => {
  return new Promise((resolve, reject) => {
    if (chunks.length == 0) {
      resolve([]);
      return;
    }
    let requestArr = [];
    let loadCount = 0;
    let curIndex = 0;
    const load = (chunk, index) => {
      if (!chunks || index >= chunks.length) {
        return;
      }
      uploadHandler(chunk)
        .then((r) => {
          requestArr[index] = r;
        })
        .catch((e) => {
          requestArr[index] = e;
        })
        .finally(() => {
          loadCount++;
          if (loadCount == chunks.length) {
            resolve(requestArr);
          } else {
            curIndex++;
            load(chunks[curIndex], curIndex);
          }
        });
    };
    for (let i = 0; i < maxRequest; i++) {
      curIndex = i;
      load(chunks[i], curIndex);
    }

    // let requestSliceArr = [];
    // let start = 0;
    // while (start < chunks.length) {
    //   requestSliceArr.push(chunks.slice(start, start + maxRequest));
    //   start += maxRequest;
    // }
    // let index = 0;
    // let requestResults = [];
    // let requestErrResults = [];
    // const request = () => {
    //   if (index > requestSliceArr.length - 1) {
    //     resolve(requestResults);
    //     return;
    //   }
    //   let sliceChunks = requestSliceArr[index];
    //   Promise.all(sliceChunks.map((chunk) => uploadHandler(chunk)))
    //     .then((res) => {
    //       requestResults.push(...(Array.isArray(res) ? res : []));
    //       index++;
    //       request();
    //     })
    //     .catch((e) => {
    //       requestErrResults.push(...(Array.isArray(e) ? e : []));
    //       reject(requestErrResults);
    //     });
    // };

    // request();
  });
};

const uploadFile = async (file) => {
  fileName = file.name;
  fileHash = await getHash(file);
  const { fileExist } = await verifyFile(fileHash, fileName);
  if (fileExist) {
    console.log("当前文件已经上传过");
    return;
  }
  let chunks = createChunks(file);
  const { index } = await verifyIntegrity(fileHash);
  if (index) {
    // 表示之前有chunk上传过 但是因为网络或其他原因 导致chunk没有全部上传完
    // chunks
    index.forEach((item) => {
      chunks[item]["uploaded"] = true;
    });
    // 只上传 uploaded标识为false的chunk
    chunks = chunks.filter((it) => !it.uploaded);
  }
  try {
    await uploadChunks(chunks);
    await mergeRequest(fileHash, fileName);
  } catch (e) {
    return {
      msg: "上传文件错误",
      err: e,
    };
  }
};

// 切片合并接口
const mergeRequest = async (fileHash, fileName) => {
  return fetch(
    `http://localhost:3000/merge?fileHash=${fileHash}&fileName=${fileName}`
  )
    .then((res) => res.json())
    .then((r) => console.log(r));
};

// 确认file是否上传过
const verifyFile = async (fileHash, fileName) => {
  return fetch(
    `http://localhost:3000/verify?fileHash=${fileHash}&fileName=${fileName}`
  )
    .then((res) => res.json())
    .then((r) => r);
};

// 验证file完整性 断点续传
const verifyIntegrity = async (fileHash) => {
  return fetch(`http://localhost:3000/verifyIntegrity?fileHash=${fileHash}`)
    .then((res) => res.json())
    .then((r) => r);
};
