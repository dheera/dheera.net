#!/bin/bash

sudo apt update
sudo apt install -y \
  nginx \
  vim \
  screen \
  python3-pip \
  htop \
  nethogs \

curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt-get install -y nodejs

rm -rf node_modules

npm install
gpg config.tar.gz.gpg
tar -zxvf config.tar.gz

