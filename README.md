### 原理
大家都知道，vue是个MVVM框架，能够实现view和model的双向绑定，不像backbone那样，model改变需要手动去通知view更新，而vue实现的原理就是通过Object.defineProperty实现数据挟持，定义setter，然后数据改变的时候通知视图更新。  
下面是网上vue的实现原理图：
![image](https://user-gold-cdn.xitu.io/2018/4/10/162ad3d5be3e5105?imageView2/0/w/1280/h/960/format/webp/ignore-error/1)

#### 1、MVVM
入口文件，在这里对vue当中的$el、methods、$data进行初始化，调用observer遍历$data的数据并进行挟持，调用compile遍历$el下的所有节点，解析之类和取值操作({{}})。遍历$data的数据，通过Object.defineProperty的getter和setter实现对$data的代理。
#### 2、Observer
遍历data，通过Object.defineProperty设置getter和setter，在setter知道数据发生了改变，然后通知Wacher去更新view。
#### 3、Compile
遍历$el下的所有节点，解析指令和取值操作等，为每个节点绑定更新函数（在这里），绑定事件和method的关系，同时也添加订阅者，当接受到视图更新的订阅消息后，调用更新函数，实现视图更新。同时在添加订阅者的时候，初始化渲染视图。
#### 4、Watcher 
Watcher作为订阅者，充当Observer和Compile的中间桥梁，包含update方法，update方法调用Compile中绑定的事件更新函数，实现对视图的初始化和更新操作。

### MVVM的实现
MVVM完成初始化操作，并且调用observer和compile。对$data进行代理，如此便可以通过this.attribute来代理this.$data.attribute。因为一个属性可能对应多个指令，所以需要一个_binding属性来存放属性对应的所有订阅者，这样属性一改变，就可以取出所有的订阅者去更新视图。
```
function MVVM(options) {
  // 初始化
  this.$data = options.data;
  this.$methods = options.methods;
  this.$el = options.el;
  // 保存data的每个属性对应的所有watcher
  this._binding  = {};
  // 调用observer和compile
  this._observer(options.data);
  this._compile();
  // this.xxx 代理this.$data.xxx
  this.proxyAttribute();
}

```
### Observer的实现
Observer遍历$data，通过Object.defineProperty的setter的挟持数据改变，监听到数据改变后取出所有该属性对应的订阅者，然后通知更新函数更新视图。  
注意：这里有循环，且闭包（getter和setter）里面需要依赖循环项（value和key），所以用立即执行函数解决循环项获取不对的问题。
```
MVVM.prototype._observer = function(data) {
  var self = this;
  for(var key in this.$data) {
    if (this.$data.hasOwnProperty(key)) {
      // 初始化属性对应的订阅者容器（数组）
      this._binding[key] = {
        _directives: [],
        _texts: []
      };

      if(typeof this.$data[key] === "object") {
        return this._observer(this.$data[key]);
      }
      var val = data[key];
      // 立即执行函数获取正确的循环项
      (function(value, key) {
        Object.defineProperty(self.$data, key, {
          enumerable: true,
          configurable: true,
          get: function() {
            return value;
          },
          set(newval) {
            if(newval === value) {
              return;
            }
            value = newval;
            // 监听到数据改变后取出所有该属性对应的订阅者，通知view更新-属性
            if(self._binding[key]._directives) {
              self._binding[key]._directives.forEach(function(watcher) {
                watcher.update();
              }, self);
            }
            // 监听到数据改变后取出所有该属性对应的订阅者，通知view更新-文本
            if(self._binding[key]._texts) {
              self._binding[key]._texts.forEach(function(watcher) {
                watcher.update();
              }, self);
            }
          }
        });
      })(val, key);
    }
  }
}
```

### Compile的实现
Compile遍历所有的节点，解析指令，为每个节点绑定更新函数，且添加订阅者，当订阅者通知view更新的时候，调用更新函数，实现对视图的更新。  
这里同样需要使用立即执行函数来解决闭包依赖的循环项问题。  
还有一点需要解决的是，如果节点的innerText依赖多个属性的话，如何做到只替换改变属性对应的文本问题。  
比如{{message}}：{{name}}已经被编译解析成“欢迎： 鸣人”，如果message改变为“你好”，怎么让使得“欢迎：鸣人”改为“你好：鸣人”。
```
MVVM.prototype._compile = function() {
  var dom = document.querySelector(this.$el);
  var children = dom.children;
  var self = this;
  var i = 0, j = 0;
  for(; i < children.length; i++) {
    var node = children[i];
    (function(node) {
      // 解析{{}}里面的内容
      // 保存指令原始内容，不然数据更新时无法完成替换
      var text = node.innerText;
      var matches = text.match(/{{([^{}]+)}}/g);
      if(matches && matches.length > 0) {
        // 保存和node绑定的所有属性
        node.bindingAttributes = [];
        for(j = 0; j < matches.length; j++) {
          // data某个属性
          var attr = matches[j].match(/{{([^{}]+)}}/)[1];
          // 将和该node绑定的data属性保存起来
          node.bindingAttributes.push(attr);
          (function(attr) {
            self._binding[attr]._texts.push(new Watcher(self, attr, function() {
              // 改变的属性值对应的文本进行替换
              var innerText = text.replace(new RegExp("{{" + attr + "}}", "g"), self.$data[attr]);
              // 如果该node绑定多个属性 eg:<div>{{title}}{{description}}</div>
              for(var k = 0; k < node.bindingAttributes.length; k++) {
                if(node.bindingAttributes[k] !== attr) {
                  // 恢复原来没改变的属性对应的文本
                  innerText = innerText.replace("{{" + node.bindingAttributes[k] + "}}", self.$data[node.bindingAttributes[k]]);
                }
              }
              node.innerText = innerText;
            }));
          })(attr);
        }
      }

      // 解析vue指令
      var attributes = node.getAttributeNames();
      for(j = 0; j < attributes.length; j++) {
        // vue指令
        var attribute = attributes[j];
        // DOM attribute
        var domAttr = null;
        // 绑定的data属性
        var vmDataAttr = node.getAttribute(attribute);
        // 更新函数，但observer中model的数据改变的时候，通过Watcher的update调用更新函数，从而更新dom
        var updater = null;
       
        if(/v-bind:([^=]+)/.test(attribute)) {
          // 解析v-bind
          domAttr = RegExp.$1;
          // 更新函数
          updater = function(val) {
            node[domAttr] = val;
          }
          // data属性绑定多个watcher
          self._binding[vmDataAttr]._directives.push(
            new Watcher(self, vmDataAttr, updater)
          )
        } else if(attribute === "v-model" && (node.tagName = 'INPUT' || node.tagName == 'TEXTAREA')) {
          // 解析v-model
          // 更新函数
          updater = function(val) {
            node.value = val;
          }
          // data属性绑定多个watcher
          self._binding[vmDataAttr]._directives.push(
            new Watcher(self, vmDataAttr, updater)
          )
          // 监听input/textarea的数据变化，同步到model去，实现双向绑定
          node.addEventListener("input", function(evt) {
            var $el = evt.currentTarget;
            self.$data[vmDataAttr] = $el.value;
          });
        } else if(/v-on:([^=]+)/.test(attribute)) {
          // 解析v-on
          var event = RegExp.$1;
          var method = vmDataAttr;
          node.addEventListener(event, function(evt) {
            self.$methods[method] && self.$methods[method].call(self, evt);
          });
        }
      }
    })(node);
  }

}
```
### Wathcer的实现
Watcher充当订阅者的角色，架起了Observer和Compile的桥梁，Observer监听到数据变化后，通知Wathcer更新视图(调用Wathcer的update方法)，Watcher再告诉Compile去调用更新函数，实现dom的更新。同时页面的初始化渲染也交给了Watcher（当然也可以放到Compile进行）。
```
function Watcher(vm, attr, cb) {
  this.vm = vm; // viewmodel
  this.attr = attr; // data的属性，一个watcher订阅一个data属性
  this.cb = cb; // 更新函数，在compile那边定义
  // 初始化渲染视图
  this.update();
}

Watcher.prototype.update = function() {
  // 通知comile中的更新函数更新dom 
  this.cb(this.vm.$data[this.attr]);
}
```

### 全部代码
git地址：https://github.com/VikiLee/MVVM.git

### 例子
```
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <title>Document</title>
</head>
<body>
  <div id="view">
    <div v-bind:id="id">
      {{message}}:{{name}}
    </div>
    <input type="text" v-model="name"/>
    <button v-on:click="handleClick">获取输入值</button>
  </div>
</body>
<script src="js/MVVM.js" type="text/javascript"></script>
<script>
  var vue = new MVVM({
    el: "#view",
    data: {
      message: "欢迎光临",
      name: "鸣人",
      id: "id"
    },
    methods: {
      handleClick: function() {
        alert(this.message + ":" + this.name + ", 点击确定路飞会出来");
        this.name = '路飞';
      }
    }
  })

  setTimeout(function() {
    vue.message = "你好";
  }, 1000);
</script>
</html>
```
