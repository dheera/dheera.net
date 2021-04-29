#!/bin/bash

sudo apt update
sudo apt install -y \
  nginx-extras \
  vim \
  screen \
  python3-pip \
  htop \
  nethogs \
  redis-server

curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt-get install -y nodejs

rm -rf node_modules

npm install

rm -rf config.tar.gz
gpg config.tar.gz.gpg
tar -zxvf config.tar.gz

sudo npm install -g pm2
pm2 startup | tail -1 | bash
pm2 stop index.js
pm2 start index.js --restart-delay=1000 --watch
pm2 save

sudo cp -rv files/* /
sudo service nginx restart

