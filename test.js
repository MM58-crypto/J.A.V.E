const readline = require('readline')


let usr_email, emails_file;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

rl.question(`Please enter your email address `, (ans1) => {
    usr_email = ans1;
    console.log('Your email ' +  usr_email);

    rl.question('Enter the file name that contains list of emails', (ans2) => {
        email_file = ans2;
        console.log('email file: ' + email_file);
        rl.close();
    });
});

/*
rl.question('Enter the file name that contains list of emails', (ans2) => {
    email_file = ans2;
    console.log('email file: ' + email_file);
  rl.close();
});
*/
