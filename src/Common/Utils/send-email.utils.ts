import * as nodemailer from 'nodemailer';
import { EventEmitter } from 'node:events';
export const Events = new EventEmitter();
export const sendEmail = async (mailOptions: nodemailer.SendMailOptions) => {
  try {
    //*
    const transporter: nodemailer.Transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT as string),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.USER_EMAIL,
        pass: process.env.USER_PASS,
      },
    });

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    throw new Error(`Failed to send email: ${error}`);
  }
};

Events.on('sendEmail', (data) => {
  sendEmail(data);
});
