import to from "await-to-js";
import * as express from "express";
import multer from "multer";
import { FixedSize } from "../utils/fixed-types";
import { adminCors } from "../utils/cors";
import { S3Service } from "../services/s3.service";

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fieldSize: 1,
    files: 1,
  },
});
const multipleUpload = multer({
  storage,
  limits: {
    fieldSize: 5,
    files: 5,
  },
});

const multipleUploadImg = async (req, res): Promise<void> => {
  multipleUpload.fields([{ name: 'file', maxCount: 5 }])(
    req,
    res,
    async error => {
      if (error) {
        res.status(400).send({
          message: `${error}`,
        });
      }
      // const s3Service: S3Service = container.get(S3Service);
      const s3Service = new S3Service ();

      const fileUploaded = (await req.files.file.map(async file => {
        return {
          name: file.originalname,
          url: await to(s3Service.uploadFile(file)),
        };
      })) as {
        name: string;
        url: string;
      }[];

      Promise.all(fileUploaded).then(values => {
        if (values) {
          const valuesImg = values.map(img => {
            if (img?.url?.[0]) {
              res.status(500).send({
                message: `${img[0].message}`,
              });
            }

            return {
              ...img,
              url: img?.url?.[1],
            };
          });
          res.status(200).send(valuesImg);
        }
      });

      return;
    },
  );
};

const singleUploadGifHandler = async (req, res): Promise<void> => {
  upload.fields([
    {
      name: 'file',
      maxCount: 1,
    },
  ])(req, res, async error => {
    if (error) {
      res.status(400).send({
        message: `${error}`,
      });
    }

    // const s3Service: S3Service = container.get(S3Service);
    const s3Service = new S3Service ();

    let image: string;
    let uploadError: Error;
    let originalName = '';
    if (req.files['file']) {
      const file = req.files['file'][0];
      originalName = file.originalname;
      if (file.mimetype == 'image/gif') {
        [uploadError, image] = await to(s3Service.uploadFile(file));
      } else {
        res.status(400).send({
          message: 'This file is not .gif file',
        });
        return;
      }
    }

    if (uploadError) {
      res.status(500).send({
        message: `${uploadError.message}`,
      });
      return;
    }

    const resJSON = {
      name: originalName,
      url: image,
    };
    res.status(200).send(resJSON);
  });
};

const singleUploadHandler = async (req, res): Promise<void> => {
  // const start = +new Date();

  upload.fields([
    {
      name: 'file',
      maxCount: 1,
    },
    {
      name: 'fileExcel',
      maxCount: 1,
    },
    { name: 'video', maxCount: 1 },
  ])(req, res, async error => {
    if (error) {
      res.status(400).send({
        message: `${error}`,
      });
    }

    // const s3Service: S3Service = container.get(S3Service);
    const s3Service = new S3Service ();

    const isResponsive = 'false' !== req.query.isResponsive;
    const useWatermark = 'false' !== req.query.useWatermark;
    let image: string;
    let uploadError: Error;
    let originalName = '';
    if (isResponsive) {
      if (req.files['video']) {
        const file = req.files['video'][0];
        originalName = file.originalname;
        [uploadError, image] = await to(s3Service.uploadFile(file));
      } else if (req.files['fileExcel']) {
        const file = req.files['fileExcel'][0];
        originalName = file.originalname;
        [uploadError, image] = await to(s3Service.uploadFile(file));
      } else {
        const file = req.files['file'][0];
        originalName = file.originalname;
        [uploadError, [image]] = await to(
          s3Service.optimizeAndUploadImage(
            file,
            [FixedSize.SMALL, FixedSize.MEDIUM, FixedSize.LARGE],
            useWatermark,
          ),
        );
        // const end = +new Date();
        // console.log(
        //   "Total request's time final 1: " + (end - start) + ' milliseconds',
        // );
      }
    } else {
      const file = req.files['file'][0];
      originalName = file.originalname;

      [uploadError, image] = await to(
        s3Service.uploadImage(file, useWatermark),
      );
    }

    if (uploadError) {
      res.status(500).send({
        message: `${uploadError.message}`,
      });
      return;
    }

    const resJSON = {
      name: originalName,
      url: image,
    };
    res.status(200).send(resJSON);

    // const end = +new Date();
    //   console.log(
    //     "Total request's time final: " + (end - start) + ' milliseconds',
    //   );
  });
};

export const singleUploadRouter = express
  .Router()
  .post('/api/single-upload', singleUploadHandler)
  .post('/admin-api/single-upload', adminCors, singleUploadHandler)
  .post('/admin-api/single-upload-gif', adminCors, singleUploadGifHandler)
  .post('/admin-api/multiple-upload', adminCors, multipleUploadImg);

