pm2 status
pm2 stop
pm2 delete backend frontends
cd /home/wkd/neruoWar/backend
pm2 start server.js --name backend

cd /home/wkd/neruoWar/frontend
pm2 start npm --name frontend -- start

用户职业系统：
求知：普通职业，一注册就给
卫道：域主和武斗官
问道：
秩序：管理员专属职业

用户（非秩序）所在地及移动

域主+域相

域主拥有建设知识域的完全权限：它决定了知识点的生产力
盟主拥有分配知识域资源的完全权限：它决定了知识点资源分配给哪些用户