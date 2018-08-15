/**
 * MVVM完成初始化操作，并且调用observer和compile。对$data进行代理，如此便可以通过this.attribute来代理this.$data.attribute。
 * 因为一个属性可能对应多个指令，所以需要一个_binding属性来存放属性对应的所有订阅者，这样属性一改变，就可以取出所有的订阅者去更新视图。
 * @param {*} options 初始化设置
 */
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

// 将this.<attr>的调用代理到this.$data.<attr>上，同时this.<attr>的值的改变也会同步到this.$data.<attr上>
MVVM.prototype.proxyAttribute = function() {
  var keys = Object.keys(this.$data);
  var self = this;
  for(var i = 0; i < keys.length; i++) {
    var key = keys[i];
    (function(key) {
      Object.defineProperty(self, key, {
        enumerable: true,
        configurable: true,
        get: function() {
          return self.$data[key];
        },
        set: function(newVal) {
          if(newVal !== self.$data[key]) {
            self.$data[key] = newVal;
          }
        }
      })
    })(key)
  }
}

/**
 * Observer遍历$data，通过Object.defineProperty的setter的挟持数据改变，监听到数据改变后取出所有该属性对应的订阅者，然后通知更新函数更新视图。  
 * 注意：这里有循环，且闭包（getter和setter）里面需要依赖循环项（value和key），所以用立即执行函数解决循环项获取不对的问题。
 */
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
/**
 * Compile遍历所有的节点，解析指令，为每个节点绑定更新函数，且添加订阅者，当订阅者通知view更新的时候，调用更新函数，实现对视图的更新。  
 * 这里同样需要使用立即执行函数来解决闭包依赖的循环项问题。  
 * 还有一点需要解决的是，如果节点的innerText依赖多个属性的话，如何做到只替换改变属性对应的文本问题。  
 * 比如{{message}}：{{name}}已经被编译解析成“欢迎： 鸣人”，如果message改变为“你好”，怎么让使得“欢迎：鸣人”改为“你好：鸣人”。
 */
MVVM.prototype._compile = function() {
  var dom = document.querySelector(this.$el);
  var children = dom.children;
  var self = this;
  var i = 0, j = 0;

  // 更新函数，但observer中model的数据改变的时候，通过Watcher的update调用更新函数，从而更新dom
  var updater = null;
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
            updater = function() {
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
            };
            self._binding[attr]._texts.push(new Watcher(self, attr, updater));
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
/**
 * Watcher充当订阅者的角色，架起了Observer和Compile的桥梁，Observer监听到数据变化后，
 * 通知Wathcer更新视图(调用Wathcer的update方法)，Watcher再告诉Compile去调用更新函数，
 * 实现dom的更新。同时页面的初始化渲染也交给了Watcher（当然也可以放到Compile进行）。
 * @param {*} vm viewmodel
 * @param {*} attr data的某个属性
 * @param {*} cb 更新函数
 */
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