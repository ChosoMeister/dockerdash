var auth = {
    user: {
        authenticated: false
    }
    ,
    login(context, creds, redirect) {
        $this = this;
        // use application/x-www-form-urlencoded
        Vue.http.options.emulateJSON = true;
        context.$http.post(window.location.origin + '/token', creds).then((response) => {

            var access_token = response.json().access_token;
            localStorage.setItem('access_token', access_token);
            $this.user.authenticated = true;

            context.$dispatch('on-login');

            Vue.http.headers.common['Authorization'] = 'Bearer ' + $this.getAccessToken();

            if (redirect) {
                router.go(redirect)
            }

        }, (response) => {
            context.error = response.body;
        });
    },
    checkAuth() {
        if (localStorage.getItem('access_token')) {
            this.user.authenticated = true;
        }
        else {
            this.user.authenticated = false;
        }

        return this.user.authenticated;
    },
    getAccessToken() {
        return localStorage.getItem('access_token')
    },
    logout() {
        localStorage.removeItem('access_token')
        this.user.authenticated = false
    }
};

var baseMixin = {
    data: function () {
        return {
            mainHub: $.connection.mainHub,
            loaded: false,
            alert: $('#alert')
        };
    },
    ready: function () {
        var $this = this;

        $.connection.hub.qs = { 'authorization': auth.getAccessToken() };

        // enable SignalR console logging
        $.connection.hub.logging = true;

        // alert on slow connection
        $.connection.hub.connectionSlow(function () {
            $this.showAlert('We are currently experiencing difficulties with the SignalR connection');
        });

        // alert on connection error
        $.connection.hub.error(function (error) {
            if (error.context && error.context.status == 401)
            {
                $this.showAlert('Session expired, please login.');
                $this.$dispatch('do-logout');
            } else {
                $this.showAlert(error);
            }

        });

        // alert on reconnected
        $.connection.hub.reconnected(function () {
            $this.showAlert('Reconnected to SignalR hub, transport ' + $.connection.hub.transport.name);
        });
    },
    methods: {
        showAlert: function (message) {
            this.alert.find("p").text(message);
            this.alert.show();
        },
        isAuthenticated: function () {
            auth.checkAuth();
        }
    },
    filters: {
        truncate: function (val, len) {
            return val.substring(0, len);
        },
        statusGlyph: function (val) {
            if (val == "running") {
                return "glyphicon-play";
            }
            if (val == "paused") {
                return "glyphicon-pause";
            }
            if (val == "restarting") {
                return "glyphicon-refresh";
            }

            return "glyphicon-stop";
        }
    }
};

var login = Vue.extend({
    template: '#login',
    data: function () {
        return {
            credentials: {
                username: '',
                password: ''
            },
            error: ''
        }
    },
    ready: function () {
        var $this = this;
    },
    methods: {
        submit() {
            var credentials = {
                username: this.credentials.username,
                password: this.credentials.password
            }
            auth.login(this, credentials, 'host')
        }
    },
    route: {
        deactivate: function () {

        }
    }
});

var host = Vue.extend({
    mixins: [baseMixin],
    template: '#host',
    data: function () {
        return {
            debouncer: null,
            timer: null,
            filterCon: '',
            filterImg: '',
            filterNet: '',
            countCon: 0,
            countImg: 0,
            countNet: 0,
            host : null,
            containers: null,
            images: null,
            networks: null,
        }
    },
    ready: function () {
        var $this = this;

        // subscribe to push events
        this.mainHub.client.onContainerEvent = this.onContainerEvent;

        // connect to SignalR hub
        $.connection.hub.start().done(function () {
            $this.loadData();
            $this.loaded = true;
        });
    },
    methods: {
        loadHost: function () {
            var $this = this;
            this.mainHub.server.getHostInfo().then(function (host) {
                $this.host = host;
            });
        },
        loadContainers: function () {
            var $this = this;
            this.mainHub.server.getContainerList().then(function (containers) {
                $this.containers = containers;
                $this.countCon = containers.length;
            });
        },
        onContainerEvent: function (event) {
            console.log(event);
            if (this.debouncer) clearTimeout(this.debouncer);
            this.debouncer = setTimeout(this.loadContainers, 1000);
        },
        loadImages: function () {
            var $this = this;
            this.mainHub.server.getImageList().then(function (images) {
                $this.images = images;
                $this.countImg = images.length;
            });
        },
        loadNetworks: function () {
            var $this = this;
            this.mainHub.server.getNetworkList().then(function (networks) {
                $this.networks = networks;
                $this.countNet = networks.length;
            });
        },
        loadData: function () {
            var $this = this;
            this.mainHub.server.getHost().then(function (data) {
                $this.host = data.host;
                $this.containers = data.containers;
                $this.countCon = data.containers.length;
                $this.images = data.images;
                $this.countImg = data.images.length;
                $this.networks = data.networks;
                $this.countNet = data.networks.length;
            });

            if (this.timer) clearTimeout(this.timer);
            this.timer = setTimeout(this.loadData, 30000);
        }
    },
    route: {
        deactivate: function () {
            if (this.timer) clearTimeout(this.timer);
            if (this.debouncer) clearTimeout(this.debouncer);
        }
    }
});

var container = Vue.extend({
    mixins: [baseMixin],
    template: '#container',
    data: function () {
        return {
            id: '',
            logs: '',
            memChart: null,
            mem: '',
            rxTotal: '',
            txTotal: '',
            iorxTotal: '',
            iotxTotal: '',
            cpuTime: '',
            pids: 0,
            timer: null,
            con: null
        }
    },
    ready: function () {
        this.id = this.$route.params.id;
        var $this = this;

        this.mainHub.client.onContainerEvent = this.onContainerEvent;
        $.connection.hub.start().done(function () {
            $this.loadData();
            $this.loaded = true;
        });
    },
    methods: {
        loadDetails: function () {
            var $this = this;
            this.mainHub.server.getContainerDetails(this.id).then(function (details) {
                $this.con = details;
                if ($this.con.State == "running") {
                    $this.loadStats();
                } else {
                    $this.mem = null;
                }
            });
        },
        loadLogs: function () {
            var $this = this;
            this.mainHub.server.getContainerLogs(this.id, 1000).then(function (logs) {
                $this.logs = logs;
            });
        },
        loadStats: function () {
            var $this = this;
            this.mainHub.server.getContainerStats(this.id).then(function (data) {

                // update stats
                $this.mem = data.memory.label;
                $this.rxTotal = data.network.labelrx;
                $this.txTotal = data.network.labeltx;
                $this.iorxTotal = data.io.labelrx;
                $this.iotxTotal = data.io.labeltx;
                $this.pids = data.pids;
                $this.cpuTime = data.cpuTime;

                //// add new memory data
                //$this.memChart.data.labels.push(data.memory.label);
                //$this.memChart.data.datasets[0].data.push(data.memory.value);
                //$this.memChart.update();

                //// remove oldest memory point 
                //if ($this.memChart.data.datasets[0].data.length == 7) {
                //    $this.memChart.data.labels.splice(0, 1);
                //    $this.memChart.data.datasets[0].data.splice(0, 1);
                //    $this.memChart.update();
                //};
            });
        },
        loadData: function () {
            this.loadDetails();
            this.loadLogs();

            // enqueue new call after 30 seconds
            if (this.timer) clearTimeout(this.timer);
            this.timer = setTimeout(this.loadData, 30000);
        },
        lineGraph: function () {
            Chart.defaults.global.responsive = true;
            Chart.defaults.global.maintainAspectRatio = true;
            Chart.defaults.global.legend.display = false;
            var ctx = $("#lineChart");
            var data = {
                labels: [],
                datasets: [
                    {
                        label: "Memory",
                        fill: true,
                        backgroundColor: "rgba(15,80,136,0.4)",
                        pointBorderColor: "#fff",
                        pointBackgroundColor: "rgba(15,80,136,1)",
                        pointHoverBackgroundColor: "rgba(57,174,225,1)",
                        pointHoverBorderColor: "rgba(220,220,220,1)",
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        data: [],
                        spanGaps: true,
                    }
                ]
            };
            var options = {
                tooltips: {
                    enabled: true,
                    mode: 'single',
                    callbacks: {
                        label: function (tooltipItems, data) {
                            return 'Memory';
                        }
                    }
                },
                scales:
                {
                    xAxes: [{
                        gridLines: {
                            display:false
                        },
                        ticks: {
                            display: false
                        }
                    }],
                    yAxes: [{
                        ticks: {
                            min: 0
                        }
                    }]
                }
            };
            this.memChart = new Chart(ctx, {
                type: 'line',
                data: data,
                options: options
            });
        }
    },
    route: {
        deactivate: function () {
            if (this.timer) clearTimeout(this.timer);
        }
    }
});

var router = new VueRouter({
    history: true,
    mode: 'html5',
    linkActiveClass: 'active',
    transitionOnLoad: true,
    root: '/'
});

router.map({
    '/': {
        component: {
            template: '',
            ready: function () {
                this.$route.router.go('/host');
            }
        },
        name: 'home',
        title: 'Home'
    },
    '/login': {
        component: login,
        name: 'login',
        title: 'Login'
    },
    '/host': {
        component: host,
        name: 'host',
        title: 'Host',
        auth: true
    },
    '/container/:id': {
        component: container,
        name: 'container',
        title: 'Container details',
        auth: true
    },
    '/about': {
        component: {
            template: '#about'
        },
        name: 'about',
        title: 'About'
    }
});

router.beforeEach(function (transition) {
    if (transition.to.auth && !auth.checkAuth()) {
        transition.redirect('/login')
    } else {
        transition.next()
    }
});

var app = Vue.extend({
    data: function () {
        return {
            authenticated: false
        };
    },
    ready: function () {
        this.authenticated = auth.checkAuth();

        if (this.authenticated) {
            Vue.http.headers.common['Authorization'] = 'Bearer ' + auth.getAccessToken();
        }
    },
    methods: {
        logout: function () {
            auth.logout();
            this.authenticated = false;
            this.$route.router.go('/login');
        }
    },
    events: {
        'on-login': function () {
            this.authenticated = true;
        },
        'do-logout': function () {
            this.logout();
        }
    }
});

router.start(app, 'html');