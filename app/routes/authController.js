const { promisify } = require('util');
const crypto        = require('crypto');
const passport      = require('passport');
const nodemailer    = require('nodemailer');

const debug         = require('debug')('app:authController');

const User          = require('../models/userModel');
const Credit        = require('../models/creditModel');
const Report        = require('../models/reportModel');


const randomBytesAsync = promisify(crypto.randomBytes);



/**
 * GET /signup
 * Signup page.
 */
exports.getSignup = (req, res) => {
  if (req.isAuthenticated()) {
    return res.status(200).json({ msg: 'Signed in' });
  }
  res.status(200).json({ msg: 'Signed out' });
};


/**
 * POST /signup
 * Create a new account.
 */
exports.postSignup = (req, res, next) => {
  req.assert('phone', 'Phone is not valid').isMobilePhone();
  req.assert('creditCard', 'Credit Card Number is not valid').isCreditCard();
  req.assert('email', 'Email is not valid').isEmail();
  req.sanitize('email').normalizeEmail({ gmail_remove_dots: false });

  const errors = req.validationErrors();

  if (errors) {
    return res.status(400).json({ msg: errors[0].msg });
  }

  let { credits } = req.body;
  let reports;
  if (credits && credits instanceof Array) {
    const tempCredits = [];
    const tempReports = [];
    const expiry = Date.now() + (2 * 365 * 24 * 60 * 60 * 1000); // 2 years

    credits.forEach((credit) => {
      let hasReport;
      let reportId;

      if (credit.generateReport) {
        // TODO: get report from API
        const report = {
          reportType: credit.creditType,
          registration: 'ABC-1234',
          stolen: false
        }; // remove this after vehicle check API integration

        const newReport = new Report(report);
        tempReports.push(newReport);
        hasReport = true;
        reportId = newReport._id;
      }

      const newCredit = new Credit({
        creditType: credit.creditType,
        expiresAt: expiry,
        hasReport,
        reportId
      });
      tempCredits.push(newCredit);
    });

    credits = tempCredits;
    reports = tempReports;
  }

  const user = new User({
    name: req.body.name,
    phone: req.body.phone,
    creditCard: req.body.creditCard,
    email: req.body.email,
    credits,
    reports
  });

  User.findOne({ email: req.body.email }, (err, existingUser) => {
    if (err) { return next(err); }
    if (existingUser) {
      return res.status(400).json({ msg: 'Email already registered' });
    }
    user.save((err) => {
      if (err) { return next(err); }
      req.logIn(user, (err) => {
        if (err) {
          return next(err);
        }
        res.status(200).json({ msg: 'Signup successful' });
      });
    });
  });
};


/**
 * GET /login
 * Login page.
 */
exports.getLogin = (req, res) => {
  if (req.isAuthenticated()) {
    return res.status(200).json({ msg: 'Signed in' });
  }
  res.status(200).json({ msg: 'Signed out' });
};


/**
 * POST /login
 * Sign in using email and password.
 */
exports.postLogin = (req, res, next) => {
  req.assert('email', 'Email is not valid').isEmail();
  req.assert('password', 'Password cannot be blank').notEmpty();
  req.sanitize('email').normalizeEmail({ gmail_remove_dots: false });

  const errors = req.validationErrors();

  if (errors) {
    return res.status(400).json({ msg: errors[0].msg });
  }

  passport.authenticate('local', (err, user, info) => {
    if (err) { return next(err); }
    if (!user) {
      return res.status(401).json(info);
    }
    req.logIn(user, (err) => {
      if (err) { return next(err); }
      res.status(200).json({ msg: 'Signed in' });
    });
  })(req, res, next);
};


/**
 * GET /logout
 * Log out.
 */
exports.logout = (req, res) => {
  req.logout();
  req.session.destroy((err) => {
    req.user = null;
    if (err) {
      debug('Error : Failed to destroy session during logout', err);
      return res.status(500).json({ msg: 'Signed out with errors' });
    }
    res.status(200).json({ msg: 'Signed out' });
  });
};


/**
 * GET /password/update
 * Update password page.
 */
exports.getUpdatePassword = (req, res) => res.status(200).json({ msg: 'Signed in' });


/**
 * POST /password/update
 * Update password.
 */
exports.postUpdatePassword = (req, res, next) => {
  req.assert('password', 'Password must be at least 8 characters long').len(8);
  req.assert('confirmPassword', 'Passwords do not match').equals(req.body.password);

  const errors = req.validationErrors();

  if (errors) {
    return res.status(400).json({ msg: errors[0].msg });
  }

  User.findOne({ email: req.user }, (err, user) => {
    if (err) { return next(err); }
    user.password = req.body.password;
    user.save((err) => {
      if (err) { return next(err); }
      res.status(200).json({ msg: 'Password updated' });
    });
  });
};


/**
 * GET /password/reset
 * Reset Password email link request page.
 */
exports.getReset = (req, res) => {
  if (req.isAuthenticated()) {
    return res.status(200).json({ msg: 'Signed in' });
  }
  res.status(200).json({ msg: 'Signed out' });
};


/**
 * POST /password/reset
 * Request Reset Password email link.
 */
exports.postReset = (req, res, next) => {
  req.assert('email', 'Email is not valid').isEmail();
  req.sanitize('email').normalizeEmail({ gmail_remove_dots: false });

  const errors = req.validationErrors();

  if (errors) {
    return res.status(400).json({ msg: errors[0].msg });
  }

  const createRandomToken = randomBytesAsync(16)
    .then(buf => buf.toString('hex'))
    .catch(err => err);

  const setRandomToken = (token) => {
    // eslint-disable-next-line implicit-arrow-linebreak
    User
      .findOne({ email: req.body.email })
      .then((user) => {
        if (!user) {
          return res.status(401).json({ msg: `Email ${req.body.email} not found` });
        }
        user.passwordResetToken = token;
        user.passwordResetExpires = Date.now() + (60 * 60 * 1000); // 1 hour

        user.save()
          .then(sendResetPasswordEmail)
          .catch(err => err);
      })
      .catch(err => err);
  };

  const sendResetPasswordEmail = (user) => {
    if (!user) {
      return res.status(500).json({ msg: 'Error sending the password reset email' });
    }
    const token = user.passwordResetToken;
    let transporter = nodemailer.createTransport({
      service: 'SendGrid',
      auth: {
        user: process.env.SENDGRID_USER,
        pass: process.env.SENDGRID_PASSWORD
      }
    });
    const mailOptions = {
      to: user.email,
      from: 'm4076788@nwytg.net', // Set from address e.g reviewingcode@gmail.com
      subject: 'Reset password requested',
      text: `You are receiving this email because you (or someone else) have requested the reset of the password for your account.\n\n
        Please click on the following link, or paste this into your browser to complete the process:\n\n
        http://${req.headers.host}/auth/password/reset/${token}\n\n
        If you did not request this, please ignore this email and your password will remain unchanged.\n`
    };
    return transporter.sendMail(mailOptions)
      .then(() => res.status(200).json({ msg: 'Email sent' }))
      .catch((err) => {
        if (err.message === 'self signed certificate in certificate chain') {
          debug('WARNING: Self signed certificate in certificate chain. Retrying with the self signed certificate. Use a valid certificate if in production.');
          transporter = nodemailer.createTransport({
            service: 'SendGrid',
            auth: {
              user: process.env.SENDGRID_USER,
              pass: process.env.SENDGRID_PASSWORD
            },
            tls: {
              rejectUnauthorized: false
            }
          });
          return transporter.sendMail(mailOptions)
            .then(() => res.status(200).json({ msg: 'Email sent' }));
        }
        debug('ERROR: Could not send forgot password email after security downgrade.\n', err);
        return err;
      });
  };

  createRandomToken
    .then(setRandomToken)
    .catch(next);
};


/**
 * GET /password/reset/:token
 * Reset Password page.
 */
exports.getResetToken = (req, res, next) => {
  User
    .findOne({ passwordResetToken: req.params.token })
    .where('passwordResetExpires').gt(Date.now())
    .exec((err, user) => {
      if (err) { return next(err); }
      if (!user) {
        return res.status(400).json({ msg: 'Invalid or expired token' });
      }
      res.status(200).json({ msg: 'Valid token' });
    });
};


/**
 * POST /password/reset/:token
 * Reset Password.
 */
exports.postResetToken = (req, res, next) => {
  req.assert('password', 'Password must be at least 8 characters long.').len(8);
  req.assert('confirmPassword', 'Passwords must match.').equals(req.body.password);

  const errors = req.validationErrors();

  if (errors) {
    return res.status(400).json({ msg: errors[0].msg });
  }

  const resetPassword = () =>
    // eslint-disable-next-line implicit-arrow-linebreak
    User
      .findOne({ passwordResetToken: req.params.token })
      .where('passwordResetExpires').gt(Date.now())
      .then((user) => {
        if (!user) {
          return res.status(400).json({ msg: 'Invalid or expired token' });
        }
        user.password = req.body.password;
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        return user.save().then(() => new Promise((resolve, reject) => {
          req.logIn(user, (err) => {
            if (err) { return reject(err); }
            resolve(user);
          });
        }));
      });

  const sendResetPasswordEmail = (user) => {
    if (!user) {
      debug('ERROR: Error sending password reset confirmation email');
      return res.status(500).json({ msg: 'Password updated with errors' });
    }
    let transporter = nodemailer.createTransport({
      service: 'SendGrid',
      auth: {
        user: process.env.SENDGRID_USER,
        pass: process.env.SENDGRID_PASSWORD
      }
    });
    const mailOptions = {
      to: user.email,
      from: 'm4076788@nwytg.net', // Set from address e.g reviewingcode@gmail.com
      subject: 'Your password has been changed',
      text: `Hello,\n\nThis is a confirmation that the password for your account ${user.email} has just been changed.\n`
    };
    return transporter.sendMail(mailOptions)
      .then(() => res.status(200).json({ msg: 'Password updated' }))
      .catch((err) => {
        if (err.message === 'self signed certificate in certificate chain') {
          debug('WARNING: Self signed certificate in certificate chain. Retrying with the self signed certificate. Use a valid certificate if in production.');
          transporter = nodemailer.createTransport({
            service: 'SendGrid',
            auth: {
              user: process.env.SENDGRID_USER,
              pass: process.env.SENDGRID_PASSWORD
            },
            tls: {
              rejectUnauthorized: false
            }
          });
          return transporter.sendMail(mailOptions)
            .then(() => res.status(200).json({ msg: 'Password updated' }));
        }
        debug('ERROR: Could not send password reset confirmation email after security downgrade.\n', err);
        return err;
      });
  };

  resetPassword()
    .then(sendResetPasswordEmail)
    .catch(err => next(err));
};


/**
 * DELETE /delete
 * Delete user account.
 */
exports.deleteAccount = (req, res, next) => {
  User.deleteOne({ email: req.user }, (err) => {
    if (err) { return next(err); }
    req.logout();
    res.status(200).json({ msg: 'Account removed' });
  });
};
